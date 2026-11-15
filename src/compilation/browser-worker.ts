import mjml2html from 'mjml-browser';
import { CompilationGuard, MJML_OPTIONS } from './guard';
import { readCompileRequest } from './generated-mjml';

const guard = new CompilationGuard();
self.onmessage = async (event: MessageEvent<unknown>) => {
  try {
    const request = readCompileRequest(event.data);
    if (!request) throw new Error('INVALID_COMPILE_INPUT');
    guard.source(request.source, request.fragments);
    const output = await mjml2html(request.source, MJML_OPTIONS);
    self.postMessage({ html: guard.output(output.html) });
  } catch {
    self.postMessage({ error: 'COMPILE_FAILED' });
  }
};
