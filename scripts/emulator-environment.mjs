import { execFileSync } from 'node:child_process';
export function emulatorEnvironment() {
  const env = { ...process.env };
  if (process.platform === 'darwin') {
    try {
      env.JAVA_HOME = execFileSync('/usr/libexec/java_home', ['-v', '21'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      env.PATH = `${env.JAVA_HOME}/bin:${env.PATH}`;
    } catch {
      throw new Error(
        'Firebase emulators need Java 21+. Install a JDK 21 and set JAVA_HOME to its installation directory.',
      );
    }
  }
  return env;
}
