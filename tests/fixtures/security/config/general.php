<?php
/**
 * Test fixture for security config scanning
 */

return [
    // HIGH: Hardcoded security key (should use env var)
    'securityKey' => 'my-super-secret-hardcoded-key-12345',

    // HIGH: CSRF protection disabled
    'enableCsrfProtection' => false,

    // HIGH: Dangerous file extensions allowed
    'extraAllowedFileExtensions' => ['php', 'svg', 'webp'],

    // These are already detected by existing rules:
    'devMode' => true,
    'allowAdminChanges' => true,
];
