"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { getStockFor } from "../../../lib/supabase/admin-catalog";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";

function revalidate(orderId?: string) {
  revalidatePath("/admin/pedidos");
  if (orderId) revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/clientes");
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type ConfirmItemRow = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  unit_price_cents: number;
  products:
    | { name: string; catalog_type: string; is_active: boolean; brands: { name: string } | { name: string }[] | null; categories: { name: string } | { name: string }[] | null }
    | Array<{ name: string; catalog_type: string; is_active: boolean; brands: { name: string } | { name: string }[] | null; categories: { name: string } | { name: string }[] | null }>
    | null;
  product_variants:
    | { name: string; attributes: Record<string, unknown>; is_active: boolean }
    | Array<{ name: string; attributes: Record<string, unknown>; is_active: boolean }>
    | null;
};

/**
 * A pedido from the public site (app/(public)/checkout/actions.ts) only ever
 * carries a single upfront price per line, so confirming it always generates
 * FULL-mode tickets. Weekly plans / layaway have no admin entry point yet
 * (there is nowhere to choose them), so this deliberately never produces them.
 */
export async function confirmOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const orderId = String(formData.get("id") ?? "");
    if (!orderId) return failure("Pedido no encontrado.");

    const db = adminDb();
    const { data: order, error: orderError } = await db
      .from("orders")
      .select("id, status, client_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) return failure(describeError(new Error(orderError.message), "No fue posible leer el pedido."));
    if (!order) return failure("Pedido no encontrado.");
    if (order.status !== "DRAFT") return failure("Solo se pueden confirmar pedidos en borrador.");

    const { data: items, error: itemsError } = await db
      .from("order_items")
      .select(
        "id, product_id, variant_id, quantity, unit_price_cents, products(name, catalog_type, is_active, brands(name), categories(name)), product_variants(name, attributes, is_active)",
      )
      .eq("order_id", orderId);
    if (itemsError) return failure(describeError(new Error(itemsError.message), "No fue posible leer los artículos del pedido."));
    if (!items || !items.length) return failure("El pedido no tiene artículos.");

    const rows = items as unknown as ConfirmItemRow[];

    const needed = new Map<string, number>();
    for (const row of rows) {
      const product = relation(row.products);
      const variant = relation(row.product_variants);
      if (!row.product_id || !product) {
        return failure("Uno de los artículos del pedido ya no tiene un producto asociado. Cancela el pedido en su lugar.");
      }
      if (!row.variant_id || !variant) {
        return failure(`"${product.name}" ya no tiene la variante que se pidió. Cancela el pedido en su lugar.`);
      }
      if (!product.is_active || !variant.is_active) {
        return failure(`"${product.name}" ya no está activo y no se puede confirmar. Cancela el pedido en su lugar.`);
      }
      needed.set(row.variant_id, (needed.get(row.variant_id) ?? 0) + row.quantity);
    }

    const stock = await getStockFor([...needed.keys()]);
    for (const [variantId, quantity] of needed) {
      const available = stock.get(variantId) ?? 0;
      if (available < quantity) {
        const row = rows.find((item) => item.variant_id === variantId);
        const product = row ? relation(row.products) : null;
        return failure(
          `No hay existencia suficiente de "${product?.name ?? "un producto"}": disponible ${available}, solicitado ${quantity}.`,
        );
      }
    }

    const productIds = [...new Set(rows.map((row) => row.product_id as string))];
    const { data: images } = await db
      .from("product_images")
      .select("product_id, storage_key, sort_order")
      .in("product_id", productIds)
      .order("sort_order", { ascending: true });
    const imageByProduct = new Map<string, string>();
    for (const image of images ?? []) {
      if (!imageByProduct.has(image.product_id as string)) {
        imageByProduct.set(image.product_id as string, image.storage_key as string);
      }
    }

    const createdTicketIds: string[] = [];
    const movementRows: Array<{ variant_id: string; movement_type: "ALLOCATION"; quantity_delta: number; ticket_id: string; reason: string; created_by_admin_id: string }> = [];

    for (const row of rows) {
      const product = relation(row.products)!;
      const variant = relation(row.product_variants)!;
      const brand = relation(product.brands);
      const category = relation(product.categories);

      const { data: ticket, error: ticketError } = await db
        .from("tickets")
        .insert({
          order_item_id: row.id,
          client_id: order.client_id,
          product_id: row.product_id,
          variant_id: row.variant_id,
          product_name_snapshot: product.name,
          brand_name_snapshot: brand?.name ?? null,
          category_name_snapshot: category?.name ?? null,
          variant_name_snapshot: variant.name,
          variant_attributes_snapshot: variant.attributes ?? {},
          image_storage_key_snapshot: imageByProduct.get(row.product_id as string) ?? null,
          quantity: row.quantity,
          cash_unit_price_cents: row.unit_price_cents,
          agreed_total_cents: row.unit_price_cents * row.quantity,
          discount_cents: 0,
          payment_mode: "FULL",
          catalog_type_snapshot: product.catalog_type,
          logistics_status: product.catalog_type === "IMMEDIATE" ? "READY_FOR_DELIVERY" : "WAITING_TO_ORDER",
        })
        .select("id")
        .single();

      if (ticketError || !ticket) {
        if (createdTicketIds.length) await db.from("tickets").delete().in("id", createdTicketIds);
        return failure(describeError(new Error(ticketError?.message ?? "error desconocido"), "No fue posible generar los tickets del pedido."));
      }

      createdTicketIds.push(ticket.id as string);
      movementRows.push({
        variant_id: row.variant_id as string,
        movement_type: "ALLOCATION",
        quantity_delta: -row.quantity,
        ticket_id: ticket.id as string,
        reason: `Pedido confirmado ${orderId.slice(0, 8).toUpperCase()}`,
        created_by_admin_id: actor.id,
      });
    }

    const { error: movementError } = await db.from("inventory_movements").insert(movementRows);
    if (movementError) {
      await db.from("tickets").delete().in("id", createdTicketIds);
      return failure(describeError(new Error(movementError.message), "No fue posible descontar el inventario del pedido."));
    }

    const { error: confirmError } = await db
      .from("orders")
      .update({ status: "CONFIRMED", confirmed_at: new Date().toISOString() })
      .eq("id", orderId);
    if (confirmError) {
      return failure(
        `Los tickets se generaron y el inventario se descontó, pero no fue posible marcar el pedido como confirmado (${confirmError.message}). Intenta de nuevo o revisa el pedido.`,
      );
    }

    await logActivity({
      adminUserId: actor.id,
      action: "ORDER_CONFIRMED",
      entityType: "orders",
      entityId: orderId,
      newData: { ticketsCreated: createdTicketIds.length },
    });
    revalidate(orderId);
    return ok(`Pedido confirmado. Se generaron ${createdTicketIds.length} ticket(s).`);
  } catch (error) {
    return failure(describeError(error, "No fue posible confirmar el pedido."));
  }
}

export async function cancelOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const orderId = String(formData.get("id") ?? "");
    if (!orderId) return failure("Pedido no encontrado.");

    const db = adminDb();
    const { data: order, error: orderError } = await db.from("orders").select("id, status").eq("id", orderId).maybeSingle();
    if (orderError) return failure(describeError(new Error(orderError.message), "No fue posible leer el pedido."));
    if (!order) return failure("Pedido no encontrado.");
    if (order.status === "CANCELLED" || order.status === "COMPLETED") {
      return failure("Este pedido ya no se puede cancelar.");
    }

    if (order.status === "CONFIRMED") {
      const { data: orderItems, error: orderItemsError } = await db.from("order_items").select("id").eq("order_id", orderId);
      if (orderItemsError) return failure(describeError(new Error(orderItemsError.message), "No fue posible leer los artículos del pedido."));
      const orderItemIds = (orderItems ?? []).map((row) => row.id as string);

      if (orderItemIds.length) {
        const { data: tickets, error: ticketsError } = await db
          .from("tickets")
          .select("id, variant_id, quantity, logistics_status")
          .in("order_item_id", orderItemIds);
        if (ticketsError) return failure(describeError(new Error(ticketsError.message), "No fue posible leer los tickets del pedido."));

        const ticketRows = tickets ?? [];
        if (ticketRows.some((ticket) => ticket.logistics_status === "DELIVERED")) {
          return failure("Este pedido ya tiene artículos entregados; no se puede cancelar desde aquí.");
        }

        const activeTickets = ticketRows.filter((ticket) => ticket.logistics_status !== "CANCELLED_INCIDENT");
        if (activeTickets.length) {
          const { error: releaseError } = await db.from("inventory_movements").insert(
            activeTickets.map((ticket) => ({
              variant_id: ticket.variant_id as string,
              movement_type: "RELEASE" as const,
              quantity_delta: Number(ticket.quantity),
              ticket_id: ticket.id as string,
              reason: `Pedido cancelado ${orderId.slice(0, 8).toUpperCase()}`,
              created_by_admin_id: actor.id,
            })),
          );
          if (releaseError) return failure(describeError(new Error(releaseError.message), "No fue posible liberar el inventario del pedido."));

          const { error: ticketUpdateError } = await db
            .from("tickets")
            .update({ financial_status: "CANCELLED_INCIDENT", logistics_status: "CANCELLED_INCIDENT" })
            .in(
              "id",
              activeTickets.map((ticket) => ticket.id as string),
            );
          if (ticketUpdateError) return failure(describeError(new Error(ticketUpdateError.message), "No fue posible actualizar los tickets del pedido."));
        }
      }
    }

    const { error: cancelError } = await db
      .from("orders")
      .update({ status: "CANCELLED", cancelled_at: new Date().toISOString() })
      .eq("id", orderId);
    if (cancelError) return failure(describeError(new Error(cancelError.message), "No fue posible cancelar el pedido."));

    await logActivity({ adminUserId: actor.id, action: "ORDER_CANCELLED", entityType: "orders", entityId: orderId });
    revalidate(orderId);
    return ok("Pedido cancelado.");
  } catch (error) {
    return failure(describeError(error, "No fue posible cancelar el pedido."));
  }
}
