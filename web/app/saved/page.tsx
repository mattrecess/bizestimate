import Footer from "@/components/Footer";
import SavedView from "@/components/SavedView";

export const metadata = { title: "Saved | SeeBITDA", robots: { index: false, follow: false } };

export default function Saved() {
  return (<><main className="page"><SavedView /></main><Footer /></>);
}
