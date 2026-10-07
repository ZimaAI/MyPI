/** Explicit opt-in for the loopback-only Docker Desktop deployment. */
export function localDockerEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env.MYPI_LOCAL_DOCKER_ENABLED !== 'true') return false;
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  let origin: URL;
  try {
    origin = new URL(env.MYPI_ORIGIN ?? '');
  } catch {
    throw new Error('Local Docker requires an explicit loopback MYPI_ORIGIN');
  }
  if (
    env.MYPI_PROFILE !== 'local' ||
    env.PUBLIC_EXECUTION_ENABLED === 'true' ||
    !loopback.includes(origin.hostname) ||
    !['http:', 'https:'].includes(origin.protocol) ||
    !['127.0.0.1', 'localhost', '::1'].includes(env.MYPI_HOST ?? '')
  )
    throw new Error(
      'Local Docker execution requires the local profile, loopback host/origin and public execution disabled',
    );
  return true;
}
