import { parentPort, workerData } from 'node:worker_threads';
import mjml2html from 'mjml';
import { CompilationGuard, MJML_OPTIONS } from './guard';
import { readCompileRequest } from './generated-mjml';

const guard = new CompilationGuard();
try {
  const request = readCompileRequest(workerData);
  if (!request) throw new Error('INVALID_COMPILE_INPUT');
  guard.source(request.source, request.fragments);
  const result = await mjml2html(request.source, MJML_OPTIONS);
  parentPort?.postMessage({ html: guard.output(result.html) });
} catch {
  parentPort?.postMessage({ error: 'COMPILE_FAILED' });
}
