import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The deliveries of the day are what staff open the panel for. */
export default function StaffHome() {
  redirect("/empleado/entregas");
}
