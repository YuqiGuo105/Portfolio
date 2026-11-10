import { useEffect, useRef } from 'react';
import SwaggerUIBundle from 'swagger-ui-dist/swagger-ui-bundle';

export default function AdminSwaggerViewer({ document }) {
  const container = useRef(null);
  useEffect(() => {
    const node = container.current;
    const viewer = SwaggerUIBundle({
      domNode: node, spec: document.spec, layout: 'BaseLayout',
      deepLinking: false, docExpansion: 'list', defaultModelsExpandDepth: -1,
      supportedSubmitMethods: [], tryItOutEnabled: false,
      validatorUrl: null, persistAuthorization: false, queryConfigEnabled: false,
      // Read-only viewer: prevent external refs, validators and API execution.
      requestInterceptor: () => { throw new Error('External documentation requests are disabled.'); },
    });
    return () => {
      viewer.specActions.updateSpec('');
      node.replaceChildren();
    };
  }, [document]);
  return <section aria-label="Protected Swagger documentation">
    <style>{document.stylesheet}</style>
    <style>{`.swagger-ui .auth-wrapper { display: none; } .swagger-ui .opblock-summary-path { overflow-wrap: anywhere; }`}</style>
    <div ref={container} />
  </section>;
}
