import PipelineSignIn from "@/components/auth/PipelineSignIn";
import { normalizePostLoginPath } from "@/lib/auth/post-login-path";

export default function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  return <SignInContent searchParams={searchParams} />;
}

async function SignInContent({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <PipelineSignIn nextPath={normalizePostLoginPath(params?.next)} />;
}
