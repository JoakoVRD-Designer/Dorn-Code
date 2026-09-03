"use strict";
const electron = require("electron");
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  electron.ipcRenderer.on(channel, listener);
  return () => electron.ipcRenderer.removeListener(channel, listener);
}
const api = {
  auth: {
    status: () => electron.ipcRenderer.invoke("dorn:auth_status"), register: (payload) => electron.ipcRenderer.invoke("dorn:auth_register", payload), verifyEmail: (payload) => electron.ipcRenderer.invoke("dorn:auth_verify_email", payload), resendVerification: (payload) => electron.ipcRenderer.invoke("dorn:auth_resend_verification", payload), login: (payload) => electron.ipcRenderer.invoke("dorn:auth_login", payload),
    googleStart: () => electron.ipcRenderer.invoke("dorn:auth_google_start"), googlePoll: (flowId, maintainSession = true) => electron.ipcRenderer.invoke("dorn:auth_google_poll", flowId, maintainSession),
    logout: () => electron.ipcRenderer.invoke("dorn:auth_logout"), activity: () => electron.ipcRenderer.invoke("dorn:auth_activity"), reportError: (payload) => electron.ipcRenderer.invoke("dorn:auth_report_error", payload),
    configureServer: (url) => electron.ipcRenderer.invoke("dorn:auth_configure_server", url), onChange: (callback) => subscribe("dorn:auth_changed", callback)
  },
  developer: { status: () => electron.ipcRenderer.invoke("dorn:developer_status"), setEnabled: (enabled) => electron.ipcRenderer.invoke("dorn:developer_set_enabled", enabled) },
  creation: {
    list: (filters = {}) => electron.ipcRenderer.invoke("dorn:creation_list", filters), scan: (projectId = null) => electron.ipcRenderer.invoke("dorn:creation_scan", projectId), tools: () => electron.ipcRenderer.invoke("dorn:creation_tools"),
    open: (id) => electron.ipcRenderer.invoke("dorn:creation_open", id), reveal: (id) => electron.ipcRenderer.invoke("dorn:creation_reveal", id), remove: (id) => electron.ipcRenderer.invoke("dorn:creation_remove", id), textPreview: (id) => electron.ipcRenderer.invoke("dorn:creation_text_preview", id)
  },
  bootstrap: () => electron.ipcRenderer.invoke("dorn:bootstrap"),
  core: {
    state: () => electron.ipcRenderer.invoke("dorn:core_state"),
    recentEvents: (limit = 100) => electron.ipcRenderer.invoke("dorn:core_events_recent", limit)
  },
  appearance: {
    get: () => electron.ipcRenderer.invoke("dorn:appearance_get"),
    save: (value) => electron.ipcRenderer.invoke("dorn:appearance_save", value),
    pickBackground: () => electron.ipcRenderer.invoke("dorn:appearance_background_pick"),
    removeBackground: () => electron.ipcRenderer.invoke("dorn:appearance_background_remove"),
    onChange: (callback) => subscribe("dorn:appearance_changed", callback)
  },
  settings: {
    save: (patch) => electron.ipcRenderer.invoke("dorn:settings_save", patch)
  },
  conversations: {
    list: (options = {}) => electron.ipcRenderer.invoke("dorn:conversations_list", options),
    create: (projectId = null) => electron.ipcRenderer.invoke("dorn:conversation_create", projectId),
    get: (id) => electron.ipcRenderer.invoke("dorn:conversation_get", id),
    rename: (id, title) => electron.ipcRenderer.invoke("dorn:conversation_rename", id, title),
    archive: (id, archived = true) => electron.ipcRenderer.invoke("dorn:conversation_archive", id, archived),
    pin: (id, pinned = true) => electron.ipcRenderer.invoke("dorn:conversation_pin", id, pinned),
    duplicate: (id) => electron.ipcRenderer.invoke("dorn:conversation_duplicate", id),
    branch: (id, anchorMessageId) => electron.ipcRenderer.invoke("dorn:conversation_branch", id, anchorMessageId),
    export: (id, format = "markdown") => electron.ipcRenderer.invoke("dorn:conversation_export", id, format),
    delete: (id) => electron.ipcRenderer.invoke("dorn:conversation_delete", id)
  },
  messages: {
    feedback: (id, feedback) => electron.ipcRenderer.invoke("dorn:message_feedback", id, feedback),
    export: (id) => electron.ipcRenderer.invoke("dorn:message_export", id)
  },
  chat: {
    recommend: (content, workspaceKind) => electron.ipcRenderer.invoke("dorn:chat_recommend", content, workspaceKind),
    send: (request) => electron.ipcRenderer.invoke("dorn:chat_send", request),
    pending: (conversationId) => electron.ipcRenderer.invoke("dorn:chat_pending", conversationId),
    decide: (conversationId, decision) => electron.ipcRenderer.invoke("dorn:chat_pending_decide", conversationId, decision),
    cancel: (requestId) => electron.ipcRenderer.invoke("dorn:chat_cancel", requestId),
    onEvent: (callback) => subscribe("dorn:chat_event", callback)
  },
  providers: {
    list: () => electron.ipcRenderer.invoke("dorn:providers_list"),
    presets: () => electron.ipcRenderer.invoke("dorn:providers_presets"),
    models: (id) => electron.ipcRenderer.invoke("dorn:provider_models", id),
    save: (draft) => electron.ipcRenderer.invoke("dorn:provider_save", draft),
    quickConnect: (input) => electron.ipcRenderer.invoke("dorn:provider_quick_connect", input),
    duplicate: (id) => electron.ipcRenderer.invoke("dorn:provider_duplicate", id),
    remove: (id) => electron.ipcRenderer.invoke("dorn:provider_remove", id),
    reorder: (ids) => electron.ipcRenderer.invoke("dorn:providers_reorder", ids),
    test: (id) => electron.ipcRenderer.invoke("dorn:provider_test", id),
    groupStatus: (id) => electron.ipcRenderer.invoke("dorn:provider_group_status", id)
  },
  localRuntime: {
    status: () => electron.ipcRenderer.invoke("dorn:local_runtime_status"),
    select: (modelId) => electron.ipcRenderer.invoke("dorn:local_runtime_select", modelId),
    download: () => electron.ipcRenderer.invoke("dorn:local_runtime_download"),
    cancelDownload: () => electron.ipcRenderer.invoke("dorn:local_runtime_cancel_download"),
    start: () => electron.ipcRenderer.invoke("dorn:local_runtime_start"),
    stop: () => electron.ipcRenderer.invoke("dorn:local_runtime_stop"),
    onStatus: (callback) => subscribe("dorn:local_runtime_status_event", callback)
  },
  linuxRuntime: {
    status: () => electron.ipcRenderer.invoke("dorn:linux_runtime_status"),
    targets: () => electron.ipcRenderer.invoke("dorn:linux_runtime_targets"),
    setupPlan: (input = {}) => electron.ipcRenderer.invoke("dorn:linux_runtime_setup_plan", input),
    toolchain: (input = {}) => electron.ipcRenderer.invoke("dorn:linux_runtime_toolchain", input),
    prepare: (projectId, input = {}) => electron.ipcRenderer.invoke("dorn:linux_runtime_prepare", projectId, input),
    executeNode: (projectId, runtimeUnitId, input = {}) => electron.ipcRenderer.invoke("dorn:linux_runtime_execute_node", projectId, runtimeUnitId, input),
    cancel: (executionId) => electron.ipcRenderer.invoke("dorn:linux_runtime_cancel", executionId)
  },
  projects: {
    list: () => electron.ipcRenderer.invoke("dorn:projects_list"),
    create: (kind, name) => electron.ipcRenderer.invoke("dorn:project_create", kind, name),
    update: (id, patch) => electron.ipcRenderer.invoke("dorn:project_update", id, patch),
    remove: (id) => electron.ipcRenderer.invoke("dorn:project_remove", id),
    metadata: (id) => electron.ipcRenderer.invoke("dorn:project_metadata", id),
    inspect: (id, options = {}) => electron.ipcRenderer.invoke("dorn:project_inspect", id, options),
    integrityStatus: (id) => electron.ipcRenderer.invoke("dorn:project_integrity_status", id),
    integrityScan: (id, options = {}) => electron.ipcRenderer.invoke("dorn:project_integrity_scan", id, options),
    impact: (id, input) => electron.ipcRenderer.invoke("dorn:project_change_impact", id, input),
    checkpoints: (id) => electron.ipcRenderer.invoke("dorn:project_checkpoints", id),
    createCheckpoint: (id, label) => electron.ipcRenderer.invoke("dorn:checkpoint_create", id, label),
    restoreCheckpoint: (id) => electron.ipcRenderer.invoke("dorn:checkpoint_restore", id)
  },
  evidence: {
    list: (projectId, options = {}) => electron.ipcRenderer.invoke("dorn:evidence_list", projectId, options),
    record: (projectId, input) => electron.ipcRenderer.invoke("dorn:evidence_record", projectId, input),
    evaluate: (projectId, evidenceId) => electron.ipcRenderer.invoke("dorn:evidence_evaluate", projectId, evidenceId),
    status: (projectId, options = {}) => electron.ipcRenderer.invoke("dorn:evidence_status", projectId, options),
    lineage: (projectId, options = {}) => electron.ipcRenderer.invoke("dorn:evidence_lineage", projectId, options)
  },
  jobs: {
    list: (projectId, options = {}) => electron.ipcRenderer.invoke("dorn:jobs_list", projectId, options),
    get: (projectId, jobId) => electron.ipcRenderer.invoke("dorn:job_get", projectId, jobId),
    cancel: (projectId, jobId) => electron.ipcRenderer.invoke("dorn:job_cancel", projectId, jobId),
    reviewInterrupted: (projectId, jobId, decision) => electron.ipcRenderer.invoke("dorn:job_review_interrupted", projectId, jobId, decision)
  },
  files: {
    pick: () => electron.ipcRenderer.invoke("dorn:file_pick"),
    pickFolder: () => electron.ipcRenderer.invoke("dorn:folder_pick"),
    revoke: (ids) => electron.ipcRenderer.invoke("dorn:attachments_revoke", ids)
  },
  window: {
    minimize: () => electron.ipcRenderer.invoke("dorn:window_minimize"),
    toggleMaximize: () => electron.ipcRenderer.invoke("dorn:window_toggle_maximize"),
    close: () => electron.ipcRenderer.invoke("dorn:window_close"),
    onState: (callback) => subscribe("dorn:window_state", callback)
  },
  links: {
    openDiscord: () => electron.ipcRenderer.invoke("dorn:open_discord")
  },
  updater: {
    check: () => electron.ipcRenderer.invoke("dorn:update_check")
  },
  v3: {
    status: () => electron.ipcRenderer.invoke("dorn:v3_status"),
    permissions: {
      get: (projectId) => electron.ipcRenderer.invoke("dorn:v3_permissions_get", projectId),
      update: (projectId, patch) => electron.ipcRenderer.invoke("dorn:v3_permissions_update", projectId, patch)
    },
    files: {
      list: (projectId, relativePath = "") => electron.ipcRenderer.invoke("dorn:v3_files_list", projectId, relativePath),
      read: (projectId, relativePath) => electron.ipcRenderer.invoke("dorn:v3_file_read", projectId, relativePath),
      preview: (request) => electron.ipcRenderer.invoke("dorn:v3_file_action_preview", request),
      apply: (approvalToken) => electron.ipcRenderer.invoke("dorn:v3_file_action_apply", approvalToken),
      history: (projectId) => electron.ipcRenderer.invoke("dorn:v3_history_list", projectId),
      previewRestore: (projectId, operationId) => electron.ipcRenderer.invoke("dorn:v3_restore_preview", projectId, operationId),
      restore: (approvalToken) => electron.ipcRenderer.invoke("dorn:v3_restore_apply", approvalToken)
    },
    terminal: {
      preview: (request) => electron.ipcRenderer.invoke("dorn:v3_terminal_preview", request),
      execute: (approvalToken) => electron.ipcRenderer.invoke("dorn:v3_terminal_execute", approvalToken),
      cancel: (processId) => electron.ipcRenderer.invoke("dorn:v3_terminal_cancel", processId)
    },
    audit: {
      recent: (limit = 100) => electron.ipcRenderer.invoke("dorn:v3_audit_recent", limit)
    },
    suite: {
      status: () => electron.ipcRenderer.invoke("dorn:suite_status"),
      verify: () => electron.ipcRenderer.invoke("dorn:suite_verify"),
      products: () => electron.ipcRenderer.invoke("dorn:suite_products"),
      openProduct: (productId) => electron.ipcRenderer.invoke("dorn:product_open", productId),
      onProductPrompt: (callback) => subscribe("dorn:product_prompt", callback),
      account: {
        status: () => electron.ipcRenderer.invoke("dorn:suite_account_status"),
        configureLocalProfile: (patch) => electron.ipcRenderer.invoke("dorn:suite_account_local_profile", patch)
      },
      recovery: {
        list: () => electron.ipcRenderer.invoke("dorn:suite_recovery_list"),
        create: (passphrase = "") => electron.ipcRenderer.invoke("dorn:suite_recovery_create", passphrase),
        verify: (filePath, passphrase = "") => electron.ipcRenderer.invoke("dorn:suite_recovery_verify", filePath, passphrase),
        restore: (filePath, passphrase, confirmation) => electron.ipcRenderer.invoke("dorn:suite_recovery_restore", filePath, passphrase, confirmation)
      },
      telemetry: {
        status: () => electron.ipcRenderer.invoke("dorn:suite_telemetry_status"),
        configure: (patch) => electron.ipcRenderer.invoke("dorn:suite_telemetry_configure", patch)
      },
      voice: {
        status: () => electron.ipcRenderer.invoke("dorn:suite_voice_status"),
        diagnostics: () => electron.ipcRenderer.invoke("dorn:voice_diagnostics"),
        speak: (text, options = {}) => electron.ipcRenderer.invoke("dorn:suite_voice_speak", text, options),
        stop: () => electron.ipcRenderer.invoke("dorn:suite_voice_stop"),
        transcribeAudio: (locale = "es-CL") => electron.ipcRenderer.invoke("dorn:voice_transcribe_pick", locale),
        startRecognition: (locale = "es-CL") => electron.ipcRenderer.invoke("dorn:voice_recognition_start", locale),
        stopRecognition: () => electron.ipcRenderer.invoke("dorn:voice_recognition_stop"),
        onRecognition: (callback) => subscribe("dorn:voice_recognition_event", callback)
      },
      images: {
        providers: () => electron.ipcRenderer.invoke("dorn:suite_image_providers"),
        generate: (options) => electron.ipcRenderer.invoke("dorn:suite_image_generate", options)
      },
      collaboration: {
        status: () => electron.ipcRenderer.invoke("dorn:suite_collaboration_status"),
        start: (options = {}) => electron.ipcRenderer.invoke("dorn:suite_collaboration_start", options),
        stop: () => electron.ipcRenderer.invoke("dorn:suite_collaboration_stop"),
        messages: () => electron.ipcRenderer.invoke("dorn:suite_collaboration_messages"),
        post: (message) => electron.ipcRenderer.invoke("dorn:suite_collaboration_post", message)
      },
      modes: {
        list: () => electron.ipcRenderer.invoke("dorn:suite_modes_list"),
        current: (projectId = null) => electron.ipcRenderer.invoke("dorn:suite_mode_current", projectId),
        select: (modeId, projectId = null) => electron.ipcRenderer.invoke("dorn:suite_mode_select", modeId, projectId),
        strategies: () => electron.ipcRenderer.invoke("dorn:suite_response_strategies"),
        strategy: (projectId = null) => electron.ipcRenderer.invoke("dorn:suite_response_strategy", projectId),
        selectStrategy: (strategyId, projectId = null) => electron.ipcRenderer.invoke("dorn:suite_response_strategy_select", strategyId, projectId)
      },
      preferences: {
        get: () => electron.ipcRenderer.invoke("dorn:suite_preferences_get"),
        configure: (patch) => electron.ipcRenderer.invoke("dorn:suite_preferences_configure", patch),
        suggestWorkspace: (text, currentWorkspace = "create") => electron.ipcRenderer.invoke("dorn:suite_workspace_suggest", text, currentWorkspace)
      },
      promptExplorer: {
        catalog: (filters = {}) => electron.ipcRenderer.invoke("dorn:suite_prompt_explorer_catalog", filters),
        get: (promptId) => electron.ipcRenderer.invoke("dorn:suite_prompt_explorer_get", promptId),
        build: (promptId, input = {}) => electron.ipcRenderer.invoke("dorn:suite_prompt_explorer_build", promptId, input),
        favorite: (promptId, favorite) => electron.ipcRenderer.invoke("dorn:suite_prompt_explorer_favorite", promptId, favorite),
        recent: () => electron.ipcRenderer.invoke("dorn:suite_prompt_explorer_recent")
      },
      memory: {
        settings: () => electron.ipcRenderer.invoke("dorn:suite_memory_settings"),
        configure: (patch) => electron.ipcRenderer.invoke("dorn:suite_memory_configure", patch),
        project: (projectId) => electron.ipcRenderer.invoke("dorn:suite_memory_project", projectId),
        remember: (projectId, entry) => electron.ipcRenderer.invoke("dorn:suite_memory_remember", projectId, entry),
        search: (projectId, query, limit = 8) => electron.ipcRenderer.invoke("dorn:suite_memory_search", projectId, query, limit),
        remove: (projectId, type, entryId = null) => electron.ipcRenderer.invoke("dorn:suite_memory_remove", projectId, type, entryId),
        export: () => electron.ipcRenderer.invoke("dorn:suite_memory_export"),
        addRelation: (relation) => electron.ipcRenderer.invoke("dorn:suite_memory_graph_add", relation)
      },
      agents: {
        roles: () => electron.ipcRenderer.invoke("dorn:suite_agents_roles"),
        plan: (request) => electron.ipcRenderer.invoke("dorn:suite_agents_plan", request),
        active: () => electron.ipcRenderer.invoke("dorn:suite_agents_active")
      },
      plugins: {
        list: () => electron.ipcRenderer.invoke("dorn:suite_plugins_list"),
        inspect: () => electron.ipcRenderer.invoke("dorn:suite_plugin_inspect"),
        install: (approvalToken, permissions) => electron.ipcRenderer.invoke("dorn:suite_plugin_install", approvalToken, permissions),
        enable: (pluginId, enabled) => electron.ipcRenderer.invoke("dorn:suite_plugin_enable", pluginId, enabled),
        remove: (pluginId, removeData = false) => electron.ipcRenderer.invoke("dorn:suite_plugin_remove", pluginId, removeData),
        invoke: (pluginId, command, input) => electron.ipcRenderer.invoke("dorn:suite_plugin_invoke", pluginId, command, input)
      },
      studio3d: {
        formats: () => electron.ipcRenderer.invoke("dorn:suite_3d_formats"),
        inspect: (projectId, relativePath) => electron.ipcRenderer.invoke("dorn:suite_3d_inspect", projectId, relativePath),
        recommend: (projectId, relativePath) => electron.ipcRenderer.invoke("dorn:suite_3d_recommend", projectId, relativePath),
        prepareEdit: (projectId, relativePath, operation) => electron.ipcRenderer.invoke("dorn:suite_3d_prepare_edit", projectId, relativePath, operation),
        createIndustrialTable: (parameters) => electron.ipcRenderer.invoke("dorn:suite_3d_create_table", parameters)
      },
      installer: {
        template: () => electron.ipcRenderer.invoke("dorn:suite_installer_template"),
        analyze: (projectId, configuration) => electron.ipcRenderer.invoke("dorn:suite_installer_analyze", projectId, configuration),
        verify: (productId) => electron.ipcRenderer.invoke("dorn:suite_installer_verify", productId),
        compare: (leftManifest, rightManifest) => electron.ipcRenderer.invoke("dorn:suite_installer_compare", leftManifest, rightManifest),
        deduplicate: (manifests) => electron.ipcRenderer.invoke("dorn:suite_installer_deduplicate", manifests)
      },
      bridge: {
        list: () => electron.ipcRenderer.invoke("dorn:suite_bridge_list"),
        inspect: (manifest) => electron.ipcRenderer.invoke("dorn:suite_bridge_inspect", manifest),
        register: (manifest, permissions) => electron.ipcRenderer.invoke("dorn:suite_bridge_register", manifest, permissions),
        enable: (connectorId, enabled) => electron.ipcRenderer.invoke("dorn:suite_bridge_enable", connectorId, enabled),
        remove: (connectorId) => electron.ipcRenderer.invoke("dorn:suite_bridge_remove", connectorId),
        run: (connectorId, operation, projectId, input, options = {}) => electron.ipcRenderer.invoke("dorn:suite_bridge_run", connectorId, operation, projectId, input, options)
      },
      help: {
        topics: () => electron.ipcRenderer.invoke("dorn:suite_help_topics"),
        search: (query, limit = 5) => electron.ipcRenderer.invoke("dorn:suite_help_search", query, limit),
        provider: (query) => electron.ipcRenderer.invoke("dorn:suite_help_provider", query),
        diagnoseProvider: (errorText) => electron.ipcRenderer.invoke("dorn:suite_help_diagnose_provider", errorText)
      },
      modelProfiles: {
        list: () => electron.ipcRenderer.invoke("dorn:suite_model_profiles"),
        get: (providerId, modelName) => electron.ipcRenderer.invoke("dorn:suite_model_profile", providerId, modelName),
        save: (providerId, modelName, patch) => electron.ipcRenderer.invoke("dorn:suite_model_profile_save", providerId, modelName, patch)
      },
      doctor: () => electron.ipcRenderer.invoke("dorn:suite_doctor")
    }
  }
};
electron.contextBridge.exposeInMainWorld("dorn", api);
