"use strict";

/**
 * Contrato propuesto para el futuro host aislado de Installer Studio.
 * Alpha.7 no carga este archivo automáticamente.
 */
module.exports = {
  async "validate-project"(input, context) {
    context.assertPermission("project:read");
    context.assertPermission("manifest:read");
    const issues = [];
    if (!input.manifest?.name) {
      issues.push({
        severity: "error",
        code: "EXAMPLE-NAME-001",
        message: "El producto necesita un nombre."
      });
    }
    return { issues };
  },

  async "transform-manifest"(input, context) {
    context.assertPermission("manifest:transform");
    return {
      manifest: {
        ...input.manifest,
        metadata: {
          ...(input.manifest.metadata || {}),
          reviewedBy: "cl.dorn.example.metadata"
        }
      }
    };
  }
};
