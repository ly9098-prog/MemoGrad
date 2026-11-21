import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveHomePath } from "@/lib/home-route";

export default async function Home() {
  const requestHeaders = await headers();
  redirect(
    resolveHomePath(
      requestHeaders.get("host"),
      process.env.ADMIN_WEB_HOST ?? process.env.ADMIN_WEB_BASE_URL,
    ),
  );
}
