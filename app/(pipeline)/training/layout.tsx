import { redirect } from "next/navigation";
import { toPipelinePath } from "@/lib/pipeline/base-path";

// Help owns the existing walkthrough library; retired training URLs return to the app.
export default function TrainingLayout() {
  redirect(toPipelinePath("/"));
}
