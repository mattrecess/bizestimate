import Footer from "@/components/Footer";
import SavedView from "@/components/SavedView";

export const metadata = { title: "My Radar | SeeBITDA", robots: { index: false, follow: false } };

export default function Radar() {
  return (<><main className="page"><SavedView /></main><Footer /></>);
}
