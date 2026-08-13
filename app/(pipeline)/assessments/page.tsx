import { redirect } from "next/navigation";

export default function AssessmentsPage() {
  redirect("/?view=reports&report=assessment-dashboard");
}
