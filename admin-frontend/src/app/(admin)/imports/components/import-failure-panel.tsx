import { AlertCircle, RefreshCw } from "lucide-react";
import { importErrorMessage } from "@/lib/imports/import-messages";

export function ImportFailurePanel({ message, onRetry, disabled = false, retryLabel = "重新上传" }: {
  message: unknown;
  onRetry: () => void;
  disabled?: boolean;
  retryLabel?: string;
}) {
  return <section className="v2-failure" role="alert" aria-label="导入失败">
    <AlertCircle className="h-5 w-5" aria-hidden="true" />
    <div><h2>导入未完成</h2><p>{importErrorMessage(message)}</p></div>
    <button type="button" className="v2-btn" onClick={onRetry} disabled={disabled}><RefreshCw className="h-4 w-4" aria-hidden="true" />{retryLabel}</button>
  </section>;
}
