import { PublicFooter } from "../../components/navigation/PublicFooter";
import { PublicHeader } from "../../components/navigation/PublicHeader";
export default function PublicLayout({ children }: { children: React.ReactNode }) { return <><PublicHeader />{children}<PublicFooter /></>; }
