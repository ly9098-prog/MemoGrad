import { useMemo, useState } from "react";
import {
  normalizeQuestionPageSize,
  positiveInt,
  readQuestionListFilters,
  type QuestionListFilters,
} from "../question-list-state";
import { buildQueryParams } from "../question-query-params";

export function resolveQuestionSafeLastPage(totalPages: number | undefined): number {
  return typeof totalPages === "number" ? Math.max(1, totalPages) : 1;
}

export function useQuestionPagination(
  searchParams: URLSearchParams,
  learnerMode = false,
) {
  const [filters, setFilters] = useState<QuestionListFilters>(() =>
    readQuestionListFilters(searchParams),
  );
  const [page, setPage] = useState(() => positiveInt(searchParams.get("page"), 1) ?? 1);
  const [pageSize, setPageSize] = useState(() =>
    normalizeQuestionPageSize(searchParams.get("page_size")),
  );
  const queryParams = useMemo(
    () => buildQueryParams(filters, page, pageSize, learnerMode),
    [filters, page, pageSize, learnerMode],
  );

  return {
    filters,
    page,
    pageSize,
    queryParams,
    setFilters,
    setPage,
    setPageSize,
  };
}
