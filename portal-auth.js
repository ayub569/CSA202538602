(() => {
    "use strict";

    const config = window.UMAR_SUPABASE_CONFIG || {};
    const configured = Boolean(config.url && config.anonKey);
    let clientPromise;

    async function getClient() {
        if (!configured) throw new Error("Supabase has not been configured.");
        if (!clientPromise) {
            clientPromise = import("https://esm.sh/@supabase/supabase-js@2")
                .then(({ createClient }) => createClient(config.url, config.anonKey, {
                    auth: {
                        autoRefreshToken: true,
                        persistSession: true,
                        detectSessionInUrl: true
                    }
                }));
        }
        return clientPromise;
    }

    window.UmarPortalAuth = {
        configured,
        accountEmailDomain: config.accountEmailDomain || "",
        getClient
    };
})();
