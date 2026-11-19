import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandHeader } from "@/components/brand-header";

export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export function LegalPage({
  title,
  intro,
  updated,
  sections,
}: {
  title: string;
  intro: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <div className="app-surface">
      <BrandHeader />
      <header className="legal-header">
        <Link href="/">
          <ArrowLeft aria-hidden="true" />
          返回账号入口
        </Link>
      </header>
      <article className="legal-article">
        <header>
          <h1>{title}</h1>
          <p>{intro}</p>
          <span className="legal-meta">版本 2026-11-20 · {updated}</span>
        </header>
        <div className="legal-sections">
          {sections.map((section) => (
            <section className="legal-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets?.length ? (
                <ul>
                  {section.bullets.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </article>
      <footer className="site-footer">
        <span>MemoGrad · 学习记录属于同一个你</span>
        <span>桂ICP备2026003057号-2X</span>
      </footer>
    </div>
  );
}
