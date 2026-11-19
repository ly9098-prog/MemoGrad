import { queryOptions } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api/client";

export const importSubjectOptions = queryOptions({
  queryKey: ["import-subject-options"],
  queryFn: ({ signal }) => apiRequest<Array<{ id: number; code: string; name: string }>>("/imports/subject-options", { signal }),
});
