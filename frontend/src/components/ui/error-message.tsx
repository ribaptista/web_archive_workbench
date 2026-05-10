import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function ErrorMessage({ message, className }: { message: string; className?: string }) {
  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      <div className={cn("flex items-start gap-3 p-4 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive", className)}>
        <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}
