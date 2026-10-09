// Line icons for the client's panel (1.6px stroke, currentColor). Decorative:
// every use sits next to a text label, so they are aria-hidden.

type IconName = "home" | "bag" | "truck" | "wallet" | "user" | "bell" | "pin" | "calendar" | "check" | "alert" | "arrow" | "back" | "clock" | "receipt" | "send" | "map";

const PATHS: Record<IconName, string> = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  bag: "M6 8h12l-1 12.5a1 1 0 0 1-1 .9H8a1 1 0 0 1-1-.9zM9 8V6.5a3 3 0 0 1 6 0V8",
  truck: "M3 6.5h10.5v9H3zM13.5 10H18l3 3.2v2.3h-7.5M7 18.5a1.6 1.6 0 1 0 0-.1M17.5 18.5a1.6 1.6 0 1 0 0-.1",
  wallet: "M4 7.5A1.5 1.5 0 0 1 5.5 6H18v3M4 7.5V18a1.5 1.5 0 0 0 1.5 1.5H20V9H5.5A1.5 1.5 0 0 1 4 7.5zM16 14.2h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5",
  bell: "M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.8H5zM10 20.5a2.2 2.2 0 0 0 4 0",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
  calendar: "M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4",
  check: "M5 12.5l4.2 4.2L19 7",
  alert: "M12 4 21 19.5H3zM12 10v4.5M12 17.2h.01",
  arrow: "M5 12h13M13 6.5l5.5 5.5-5.5 5.5",
  back: "M19 12H6M11 6.5 5.5 12l5.5 5.5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
  receipt: "M6 3.5h12v17l-2.2-1.4-1.9 1.4-1.9-1.4-1.9 1.4-1.9-1.4L6 20.5zM9 8.5h6M9 12h6M9 15.5h3.5",
  send: "M4 11.5 20 4l-6.5 16-2.3-6.3zM11.2 13.7 20 4",
  map: "M9 5 3.5 7v12L9 17l6 2 5.5-2V5L15 7zM9 5v12M15 7v12",
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
