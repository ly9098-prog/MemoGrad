import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

export function BrandHeader({
  authenticated = false,
}: {
  authenticated?: boolean;
}) {
  return (
    <header className="site-header">
      <Link href="/" className="brand-lockup" aria-label="MemoGrad 首页">
        <Image src="/memograd-mark.svg" alt="" width={40} height={40} />
        <span>
          <strong>MemoGrad</strong>
        </span>
      </Link>
      <nav className="header-actions" aria-label="账户导航">
        {authenticated ? (
          <>
            <Link href="/settings">账号安全</Link>
            <Link href="/" className="header-primary">
              我的账号
            </Link>
          </>
        ) : (
          <>
            <Link href="/agreements/user">服务说明</Link>
            <Link href="/" className="header-primary">
              登录或注册
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
