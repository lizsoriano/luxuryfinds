-- Ejecutar manualmente después de 014_shipments.sql. Solo lectura reducida;
-- no cambia mercancía, costos, permisos OWNER ni el flujo de recepción.
BEGIN;
SET search_path TO luxury_finds, public;
CREATE OR REPLACE VIEW staff_shipment_lines AS
SELECT l.id, l.shipment_id, l.position, l.assignment_id, l.expected_quantity,
       l.received_good_quantity, l.received_damaged_quantity, l.missing_quantity,
       l.status, i.name, i.variant_label, t.ticket_number,
       concat_ws(' ', c.first_name, c.last_name) AS client_name
FROM shipment_lines l
JOIN purchase_items i ON i.id = l.purchase_item_id
LEFT JOIN purchase_assignments a ON a.id = l.assignment_id
LEFT JOIN tickets t ON t.id = a.ticket_id
LEFT JOIN clients c ON c.id = a.client_id;
REVOKE ALL ON staff_shipment_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON staff_shipment_lines TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
