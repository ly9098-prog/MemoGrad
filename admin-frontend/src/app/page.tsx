import { redirect } from "next/navigation";
import { DASHBOARD_PATH } from "@/lib/home-route";

export default function Home() {
  redirect(DASHBOARD_PATH);
}
