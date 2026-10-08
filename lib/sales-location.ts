import { LOGISTICS_STATUS_LABELS } from "./format";
import { STAGE_LABELS, type SalesStage } from "./sales-feed";

export const SALES_LOCATION_STATUSES = ["ORDERED", "IN_TRANSIT", "RECEIVED_LA_PAZ", "READY_FOR_DELIVERY"];
export function trackingLocationLabel(line: { logisticsStatus: string | null; stage: SalesStage }) {
  return line.logisticsStatus ? LOGISTICS_STATUS_LABELS[line.logisticsStatus] ?? STAGE_LABELS[line.stage] : STAGE_LABELS[line.stage];
}
export function needsPickup(line: { logisticsStatus: string | null; stage: SalesStage }) {
  return line.stage !== "CANCELLED" && line.logisticsStatus === "READY_FOR_DELIVERY";
}
export function trackingSummaryLabel(tracking: { stage: SalesStage; lines: Array<{ logisticsStatus: string | null; stage: SalesStage }> }) {
  if (tracking.stage !== "CANCELLED" && tracking.lines.length && tracking.lines.every(line => line.logisticsStatus && line.logisticsStatus === tracking.lines[0].logisticsStatus)) return trackingLocationLabel(tracking.lines[0]);
  return STAGE_LABELS[tracking.stage];
}
