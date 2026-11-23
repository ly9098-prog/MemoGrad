import Link from "next/link";
import { BookOpen } from "lucide-react";

export function LearnerComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <section
        className="max-w-2xl border-t border-border py-12 sm:py-16"
        aria-labelledby="coming-soon-title"
      >
        <BookOpen className="h-8 w-8 text-primary" aria-hidden="true" />
        <h2 id="coming-soon-title" className="mt-6 text-xl font-medium">
          敬请期待
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">
          {"用户端相关功能敬请期待，完整功能使用暂时移步小程序端"}
        </p>
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-4 text-sm">
          <Link
            href="/questions"
            className="text-primary underline underline-offset-4"
          >
            浏览题库
          </Link>
          <Link
            href="/formulas"
            className="text-primary underline underline-offset-4"
          >
            预览公式库
          </Link>
        </div>
      </section>
    </div>
  );
}
