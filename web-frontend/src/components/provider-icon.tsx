import Image from "next/image";
import { KeyRound, Mail, MessageCircle } from "lucide-react";

export function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "github") {
    return <Image src="/github-invertocat-black.svg" alt="" width={18} height={18} />;
  }
  const Icon = provider === "email" ? Mail : provider === "wechat" ? MessageCircle : KeyRound;
  return <Icon aria-hidden="true" />;
}
