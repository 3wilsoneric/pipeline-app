import { redirect } from "next/navigation";
import { toPipelinePath } from "@/lib/pipeline/base-path";

// Retired training URLs return to the app.
export default function TrainingLayout() {
  redirect(toPipelinePath("/"));
}
