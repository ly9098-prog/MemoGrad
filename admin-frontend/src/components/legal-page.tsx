import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export function LegalPage({
  title,
  intro,
  version,
  updated,
  sections,
}: {
  title: string;
  intro: string;
  version: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <main className="admin-content-theme min-h-dvh bg-background px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/account/login"
            className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:border-primary/35 hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回账号入口
          </Link>
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            MemoGrad
          </span>
        </header>

        <article className="admin-panel mt-6 rounded-[22px] p-6 sm:p-8">
          <header className="border-b border-border pb-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              Account & Privacy
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-foreground">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">{intro}</p>
            <p className="mt-3 text-xs text-muted-foreground">版本 {version} · {updated}</p>
          </header>

          <div className="divide-y divide-border">
            {sections.map((section) => (
              <section className="py-6" key={section.title}>
                <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p className="mt-3 text-sm leading-7 text-muted-foreground" key={paragraph}>
                    {paragraph}
                  </p>
                ))}
                {section.bullets?.length ? (
                  <ul className="mt-3 space-y-2.5">
                    {section.bullets.map((item) => (
                      <li
                        className="flex gap-2.5 text-sm leading-7 text-muted-foreground"
                        key={item}
                      >
                        <span className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}
