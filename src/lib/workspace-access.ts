export function workspaceAccess(
  userId: string | undefined,
  loading: boolean,
  demoRequested: boolean,
) {
  return {
    destination: userId ? "/map" : "/auth",
    demo: !loading && !userId && demoRequested,
    canEnterDemo: !loading && !userId,
  };
}
