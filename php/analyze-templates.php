<?php
/**
 * Craft CMS Template Analyzer
 * 
 * Analyzes Twig templates for common Craft CMS performance issues:
 * - N+1 query patterns (field access in loops without eager loading)
 * - Missing .with() eager loading
 * - Missing .limit() on queries
 * - Deprecated Craft CMS syntax
 * 
 * Usage: php analyze-templates.php <templates-directory>
 * Output: JSON array of issues
 */

// Patterns that indicate element queries
$QUERY_PATTERNS = [
    'craft\.entries',
    'craft\.assets', 
    'craft\.users',
    'craft\.categories',
    'craft\.tags',
    'craft\.globalSets',
    'craft\.matrixBlocks',
];

$MISSING_LIMIT_QUERY_PATTERNS = [
    'craft\.entries',
    'craft\.assets',
    'craft\.users',
];

$NARROWING_QUERY_METHODS = [
    '.id(',
    '.slug(',
    '.relatedTo(',
    '.siteId(',
    '.level(',
    '.uri(',
    '.search(',
    '.eventDate(',
    '.postDate(',
    '.dateCreated(',
    '.dateUpdated(',
    '.ancestorOf(',
    '.descendantOf(',
    '.type(',
    '.group(',
    '.fixedOrder(',
    '.kind(',
    '.status(',
];

// Relation field patterns that need eager loading
$RELATION_FIELD_METHODS = [
    '\.one\(\)',
    '\.all\(\)',
    '\.first\(\)',
    '\.last\(\)',
];

// XSS patterns - |raw filter on potentially unsafe content
$XSS_HIGH_PATTERNS = [
    // Request parameters rendered raw - definitely dangerous
    [
        'pattern' => '/\{\{\s*craft\.app\.request\.[^}]*\|raw/',
        'message' => 'Request parameter rendered with |raw filter (XSS risk)',
    ],
    [
        'pattern' => '/\{\{\s*craft\.request\.[^}]*\|raw/',
        'message' => 'Request parameter rendered with |raw filter (XSS risk)',
    ],
];

// General |raw usage pattern (medium severity)
$XSS_RAW_PATTERN = '/\{\{\s*([^}|]+)\|raw\s*\}\}/';

// Safe patterns that precede |raw - skip these
$XSS_SAFE_PREFIXES = ['|purify', '|striptags', '|escape'];

// Debug patterns to remove
$DEBUG_PATTERNS = [
    '/\{\{\s*dump\s*\(/',   // {{ dump(...) }}
    '/\{\{\s*dd\s*\(/',      // {{ dd(...) }} - dump and die
    '/\{%-?\s+dump\b/',       // {% dump expr %} - Twig dump tag
];

// Include tag pattern (should use include() function instead)
$INCLUDE_TAG_PATTERN = '/\{%\s*include\s+[\'"]([^\'"]+)[\'"]\s*%\}/';

// SSTI (Server-Side Template Injection) patterns - CRITICAL security
$SSTI_PATTERNS = [
    // Dynamic include with variable (not a string literal)
    [
        'pattern' => '/\{%\s*include\s+(?![\'"])[a-zA-Z_]/',
        'message' => 'Dynamic template include with variable (potential SSTI)',
        'suggestion' => 'Use a literal string path or whitelist allowed templates. Never include user-controlled paths.',
    ],
    // template_from_string() usage
    [
        'pattern' => '/template_from_string\s*\(/',
        'message' => 'template_from_string() can enable SSTI if input is user-controlled',
        'suggestion' => 'Avoid template_from_string() with user input. Use pre-defined templates instead.',
    ],
    // source() with variable (file disclosure risk)
    [
        'pattern' => '/\{\{\s*source\s*\(\s*(?![\'"])[a-zA-Z_]/',
        'message' => 'Dynamic source() with variable (potential path traversal)',
        'suggestion' => 'Use literal paths with source() or validate/whitelist the path.',
    ],
];

// Deprecated patterns in Craft 4/5
$DEPRECATED_PATTERNS = [
    [
        'pattern' => '/craft\.request\./',
        'message' => 'craft.request is deprecated',
        'suggestion' => 'Use craft.app.request instead',
        'fix' => [
            'safe' => true,
            'search' => 'craft.request.',
            'replacement' => 'craft.app.request.',
            'description' => 'Replace with craft.app.request',
        ],
    ],
    [
        'pattern' => '/\|date_modify\b/',
        'message' => '|date_modify filter is deprecated',
        'suggestion' => 'Use |date("modify format") or native Twig date functions',
        'fix' => null, // No safe auto-fix available
    ],
    [
        'pattern' => '/getUrl\(\)/',
        'message' => 'getUrl() is deprecated for assets',
        'suggestion' => 'Use .url property instead',
        'fix' => [
            'safe' => true,
            'search' => '.getUrl()',
            'replacement' => '.url',
            'description' => 'Replace with .url property',
        ],
    ],
    [
        'pattern' => '/craft\.config\./',
        'message' => 'craft.config is deprecated',
        'suggestion' => 'Use craft.app.config.general instead',
        'fix' => [
            'safe' => true,
            'search' => 'craft.config.',
            'replacement' => 'craft.app.config.general.',
            'description' => 'Replace with craft.app.config.general',
        ],
    ],
    [
        'pattern' => '/\{%-?\s+includeJsFile\b/',
        'message' => 'includeJsFile tag is deprecated',
        'suggestion' => 'Use craft.app.view.registerJsFile() instead',
        'fix' => null, // Complex replacement, not safe to auto-fix
    ],
    [
        'pattern' => '/\{%-?\s+includeCssFile\b/',
        'message' => 'includeCssFile tag is deprecated',
        'suggestion' => 'Use craft.app.view.registerCssFile() instead',
        'fix' => null, // Complex replacement, not safe to auto-fix
    ],
    [
        'pattern' => '/\{%-?\s+includeCss\b(?!File)/',
        'message' => '{% includeCss %} tag is deprecated since Craft 3.x',
        'suggestion' => 'Use {% css %}...{% endcss %} instead',
        'fix' => null, // Block tag replacement, not safe to auto-fix
    ],
    [
        'pattern' => '/\{%-?\s+includeJs\b(?!File)/',
        'message' => '{% includeJs %} tag is deprecated since Craft 3.x',
        'suggestion' => 'Use {% js %}...{% endjs %} instead',
        'fix' => null, // Block tag replacement, not safe to auto-fix
    ],
];

function analyzeFile(string $filePath, string $basePath): array {
    global $QUERY_PATTERNS, $MISSING_LIMIT_QUERY_PATTERNS, $NARROWING_QUERY_METHODS, $RELATION_FIELD_METHODS, $DEPRECATED_PATTERNS, $XSS_HIGH_PATTERNS, $XSS_RAW_PATTERN, $XSS_SAFE_PREFIXES, $SSTI_PATTERNS, $DEBUG_PATTERNS, $INCLUDE_TAG_PATTERN;

    $issues = [];
    $content = file_get_contents($filePath);
    $lines = explode("\n", $content);
    $relativePath = str_replace($basePath . '/', '', $filePath);

    // Parse suppression comments: {# craft-audit-disable-next-line [rule-id, ...] #}
    // Maps line number -> array of suppressed rule patterns (empty array = all rules)
    $suppressions = [];
    foreach ($lines as $lineNum => $line) {
        if (preg_match('/\{#\s*craft-audit-disable-next-line\s*([^#]*)\s*#\}/', $line, $matches)) {
            $nextLine = $lineNum + 2; // +1 for 0-index, +1 for "next line"
            $ruleList = trim($matches[1]);
            if ($ruleList === '') {
                // Suppress all rules on next line
                $suppressions[$nextLine] = [];
            } else {
                // Suppress specific rules
                $rules = array_map('trim', explode(',', $ruleList));
                $suppressions[$nextLine] = $rules;
            }
        }
    }

    // Helper to check if an issue should be suppressed
    $isSuppressed = function(int $line, string $pattern) use ($suppressions): bool {
        if (!isset($suppressions[$line])) {
            return false;
        }
        $rules = $suppressions[$line];
        // Empty array means suppress all rules
        if (empty($rules)) {
            return true;
        }
        // Check if specific pattern is in suppressed list
        // Match pattern with various category prefixes
        foreach ($rules as $rule) {
            if ($rule === $pattern ||
                $rule === "template/{$pattern}" ||
                $rule === "security/{$pattern}") {
                return true;
            }
        }
        return false;
    };

    // Track context
    $inForLoop = false;
    $forLoopStart = 0;
    $forLoopVar = '';
    $forLoopQueryLine = 0;
    $hasEagerLoading = false;
    $queryAssignments = [];
    $seenRelationIssues = [];
    $usesWithInFile = false;
    $usesEagerlyInFile = false;
    $withLines = [];
    $eagerlyLines = [];

    // Form CSRF tracking state
    $inFormTag = false;
    $formStartLine = 0;
    $formStartCode = '';
    $hasCsrfInput = false;
    $isGetForm = false;

    foreach ($lines as $lineNum => $line) {
        $lineNumber = $lineNum + 1;

        // Track query variables: {% set items = craft.entries... %}
        if (preg_match('/\{%\s*set\s+(\w+)\s*=\s*(.+?)\s*%\}/', $line, $setMatches)) {
            $setVar = $setMatches[1];
            $setExpr = trim($setMatches[2]);

            // Track query variable chaining: {% set query = query.relatedTo(...) %}
            if (preg_match('/^(\w+)(\..+)$/', $setExpr, $chainMatches)) {
                $baseVar = $chainMatches[1];
                if (isset($queryAssignments[$baseVar])) {
                    $queryAssignments[$setVar] = [
                        'source' => $queryAssignments[$baseVar]['source'] . $chainMatches[2],
                        'line' => $lineNumber,
                    ];
                    continue;
                }
            }

            foreach ($QUERY_PATTERNS as $pattern) {
                if (preg_match('/' . $pattern . '/', $setExpr)) {
                    $queryAssignments[$setVar] = [
                        'source' => $setExpr,
                        'line' => $lineNumber,
                    ];
                    break;
                }
            }
        }
        
        // Detect for loop start
        if (preg_match('/\{%\s*for\s+(\w+)\s+in\s+(.+?)\s*%\}/', $line, $matches)) {
            $inForLoop = true;
            $forLoopStart = $lineNumber;
            $forLoopVar = $matches[1];
            $forLoopQueryLine = $lineNumber;
            
            // Check if the query has .with()
            $querySource = trim($matches[2]);

            // Resolve query variables assigned via {% set q = craft.entries... %}
            if (isset($queryAssignments[$querySource])) {
                $assignment = $queryAssignments[$querySource];
                $querySource = $assignment['source'];
                $forLoopQueryLine = $assignment['line'];
            }

            $hasEagerLoading = strpos($querySource, '.with(') !== false;

            // Track loading strategy usage for consistency check
            if ($hasEagerLoading) {
                $usesWithInFile = true;
                $withLines[] = $lineNumber;
            }
            
            // Check for missing .limit() on entry queries
            foreach ($MISSING_LIMIT_QUERY_PATTERNS as $pattern) {
                if (preg_match('/' . $pattern . '/', $querySource)) {
                    $hasTerminalLimiter = strpos($querySource, '.limit(') !== false ||
                        strpos($querySource, '.one()') !== false ||
                        strpos($querySource, '.first()') !== false ||
                        strpos($querySource, '.count()') !== false ||
                        strpos($querySource, '.exists()') !== false ||
                        strpos($querySource, '.ids()') !== false;

                    $hasNarrowingMethod = false;
                    foreach ($NARROWING_QUERY_METHODS as $methodPattern) {
                        if (strpos($querySource, $methodPattern) !== false) {
                            $hasNarrowingMethod = true;
                            break;
                        }
                    }

                    if (!$hasTerminalLimiter && !$hasNarrowingMethod && !$isSuppressed($forLoopQueryLine, 'missing-limit')) {
                        $issues[] = [
                            'severity' => 'medium',
                            'category' => 'template',
                            'pattern' => 'missing-limit',
                            'file' => $relativePath,
                            'line' => $forLoopQueryLine,
                            'message' => 'Query in loop without .limit() may fetch too many results',
                            'suggestion' => 'Add .limit(n) to paginate results',
                            'code' => trim($querySource),
                            'fix' => [
                                'safe' => true,
                                'search' => '.all()',
                                'replacement' => '.limit(100).all()',
                                'description' => 'Add .limit(100)',
                            ],
                        ];
                    }

                    // Check for missing .status() filter (may fetch drafts/disabled)
                    $hasStatusFilter = strpos($querySource, '.status(') !== false;
                    $fetchesAll = strpos($querySource, '.all()') !== false;
                    if ($fetchesAll && !$hasStatusFilter && !$isSuppressed($forLoopQueryLine, 'missing-status-filter')) {
                        $issues[] = [
                            'severity' => 'low',
                            'category' => 'template',
                            'pattern' => 'missing-status-filter',
                            'file' => $relativePath,
                            'line' => $forLoopQueryLine,
                            'message' => 'Query uses .all() without .status() filter - may include drafts/disabled entries',
                            'suggestion' => "Add .status('live') to only fetch published entries, or .status(['live', 'pending']) if needed",
                            'code' => trim($querySource),
                            'fix' => [
                                'safe' => true,
                                'search' => '.all()',
                                'replacement' => ".status('live').all()",
                                'description' => "Add .status('live')",
                            ],
                        ];
                    }
                    break;
                }
            }
        }
        
        // Detect for loop end
        if (preg_match('/\{%\s*endfor\s*%\}/', $line)) {
            $inForLoop = false;
            $hasEagerLoading = false;
            $forLoopVar = '';
            $forLoopQueryLine = 0;
        }
        
        // Inside a for loop, check for relation field access (N+1 pattern)
        if ($inForLoop && $forLoopVar) {
            // Check for common N+1 patterns: entry.relatedField.one(), entry.relatedField.all()
            foreach ($RELATION_FIELD_METHODS as $method) {
                $pattern = '/' . preg_quote($forLoopVar, '/') . '\.(\w+)' . $method . '/';
                if (preg_match($pattern, $line, $matches)) {
                    $fieldName = $matches[1];
                    
                    // Skip known non-relation properties
                    $skipFields = ['id', 'title', 'slug', 'url', 'status', 'dateCreated', 'dateUpdated', 'author'];
                    if (in_array($fieldName, $skipFields)) {
                        continue;
                    }
                    
                    if (!$hasEagerLoading) {
                        $issueKey = "{$forLoopQueryLine}:{$forLoopVar}:{$fieldName}:{$method}";
                        if (isset($seenRelationIssues[$issueKey])) {
                            continue;
                        }
                        $seenRelationIssues[$issueKey] = true;

                        // Check if using .eagerly() on this specific access (Craft 5)
                        $hasEagerlyOnAccess = preg_match(
                            '/' . preg_quote($forLoopVar, '/') . '\.' . preg_quote($fieldName, '/') . '\.eagerly\(\)/',
                            $line
                        );

                        if (!$hasEagerlyOnAccess && !$isSuppressed($lineNumber, 'n+1')) {
                            $issues[] = [
                                'severity' => 'high',
                                'category' => 'template',
                                'pattern' => 'n+1',
                                'file' => $relativePath,
                                'line' => $lineNumber,
                                'message' => "Potential N+1 query: {$forLoopVar}.{$fieldName}" . str_replace('\\', '', $method) . " inside loop",
                                'suggestion' => "Add .with(['{$fieldName}']) to the query on line " . ($forLoopQueryLine ?: $forLoopStart) . ", or use .eagerly() for lazy loading (Craft 5+): {$forLoopVar}.{$fieldName}.eagerly()" . str_replace('\\', '', $method),
                                'code' => trim($line),
                            ];
                        }
                    }
                }
            }
            
            // Check for .eagerly() usage (Craft 5 lazy eager loading)
            if (preg_match('/' . preg_quote($forLoopVar, '/') . '\.(\w+)\.eagerly\(\)/', $line)) {
                // This is good - they're using lazy eager loading
                $usesEagerlyInFile = true;
                $eagerlyLines[] = $lineNumber;
                continue;
            }
        }
        
        // Check for deprecated patterns
        foreach ($DEPRECATED_PATTERNS as $deprecated) {
            if (preg_match($deprecated['pattern'], $line) && !$isSuppressed($lineNumber, 'deprecated')) {
                $issue = [
                    'severity' => 'medium',
                    'category' => 'template',
                    'pattern' => 'deprecated',
                    'file' => $relativePath,
                    'line' => $lineNumber,
                    'message' => $deprecated['message'],
                    'suggestion' => $deprecated['suggestion'],
                    'code' => trim($line),
                ];
                if (isset($deprecated['fix']) && $deprecated['fix'] !== null) {
                    $issue['fix'] = $deprecated['fix'];
                }
                $issues[] = $issue;
            }
        }

        // Check for XSS patterns - |raw filter usage
        if (!$isSuppressed($lineNumber, 'xss-raw-output')) {
            // First check high-severity patterns (request params)
            $foundHighSeverity = false;
            foreach ($XSS_HIGH_PATTERNS as $xssPattern) {
                if (preg_match($xssPattern['pattern'], $line)) {
                    $issues[] = [
                        'severity' => 'high',
                        'category' => 'template',
                        'pattern' => 'xss-raw-output',
                        'file' => $relativePath,
                        'line' => $lineNumber,
                        'message' => $xssPattern['message'],
                        'suggestion' => 'Never render request parameters with |raw. Use |e or |purify for user content.',
                        'code' => trim($line),
                    ];
                    $foundHighSeverity = true;
                }
            }

            // Check general |raw usage (medium severity) if not already flagged
            if (!$foundHighSeverity && preg_match($XSS_RAW_PATTERN, $line, $rawMatches)) {
                $variable = trim($rawMatches[1]);

                // Check if preceded by safe filter
                $isSafe = false;
                foreach ($XSS_SAFE_PREFIXES as $safePrefix) {
                    if (strpos($line, $safePrefix . '|raw') !== false) {
                        $isSafe = true;
                        break;
                    }
                }

                if (!$isSafe) {
                    $issues[] = [
                        'severity' => 'medium',
                        'category' => 'template',
                        'pattern' => 'xss-raw-output',
                        'file' => $relativePath,
                        'line' => $lineNumber,
                        'message' => "Variable rendered with |raw filter: {$variable}",
                        'suggestion' => 'Verify this content is trusted. Use |purify for user-generated HTML or remove |raw.',
                        'code' => trim($line),
                        'fix' => [
                            'safe' => false,
                            'search' => '|raw',
                            'replacement' => '|e|raw',
                            'description' => 'Add |e escape filter (may break intentional HTML)',
                        ],
                    ];
                }
            }
        }

        // Check for SSTI (Server-Side Template Injection) patterns
        if (!$isSuppressed($lineNumber, 'ssti-dynamic-include')) {
            foreach ($SSTI_PATTERNS as $sstiPattern) {
                if (preg_match($sstiPattern['pattern'], $line)) {
                    $issues[] = [
                        'severity' => 'high',
                        'category' => 'template',
                        'pattern' => 'ssti-dynamic-include',
                        'file' => $relativePath,
                        'line' => $lineNumber,
                        'message' => $sstiPattern['message'],
                        'suggestion' => $sstiPattern['suggestion'],
                        'code' => trim($line),
                    ];
                }
            }
        }

        // Check for debug output (dump/dd calls)
        if (!$isSuppressed($lineNumber, 'dump-call')) {
            foreach ($DEBUG_PATTERNS as $debugPattern) {
                if (preg_match($debugPattern, $line)) {
                    $issues[] = [
                        'severity' => 'medium',
                        'category' => 'template',
                        'pattern' => 'dump-call',
                        'file' => $relativePath,
                        'line' => $lineNumber,
                        'message' => 'Debug output (dump/dd) should not be in production templates',
                        'suggestion' => 'Remove dump() or dd() calls before deploying to production',
                        'code' => trim($line),
                        'fix' => [
                            'safe' => false,
                            'search' => trim($line),
                            'replacement' => '',
                            'description' => 'Remove debug line (may be intentional)',
                        ],
                    ];
                    break; // Only report once per line
                }
            }
        }

        // Check for {% include %} tag (should use include() function for performance)
        if (!$isSuppressed($lineNumber, 'include-tag') && preg_match($INCLUDE_TAG_PATTERN, $line, $includeMatches)) {
            $templatePath = $includeMatches[1];
            $issues[] = [
                'severity' => 'low',
                'category' => 'template',
                'pattern' => 'include-tag',
                'file' => $relativePath,
                'line' => $lineNumber,
                'message' => 'Use include() function instead of {% include %} tag for better performance',
                'suggestion' => "Replace {% include '{$templatePath}' %} with {{ include('{$templatePath}') }}",
                'code' => trim($line),
                'fix' => [
                    'safe' => true,
                    'search' => "{% include '{$templatePath}' %}",
                    'replacement' => "{{ include('{$templatePath}') }}",
                    'description' => 'Convert to include() function',
                ],
            ];
        }

        // Check for queries without .all() or .one() (inefficient)
        foreach ($QUERY_PATTERNS as $pattern) {
            if (preg_match('/(' . $pattern . '\([^)]*\)(?:\.[^}]+)?)(?!\.(all|one|first|last|count|exists|ids)\(\))/', $line, $matches)) {
                // Check if this is inside a for loop (which would auto-execute)
                if (!$inForLoop && !preg_match('/\{%\s*for/', $line)) {
                    // This might be a query being built but not executed - that's actually fine
                    // Skip this check as it produces too many false positives
                }
            }
        }

        // Track <form> tags for missing CSRF token detection
        if (preg_match('/<form\b/i', $line)) {
            $inFormTag = true;
            $formStartLine = $lineNumber;
            $formStartCode = trim($line);
            $hasCsrfInput = false;
            $isGetForm = (bool) preg_match('/method\s*=\s*["\']?\s*get\b/i', $line);
        }

        if ($inFormTag && strpos($line, 'csrfInput()') !== false) {
            $hasCsrfInput = true;
        }

        if ($inFormTag && preg_match('/<\/form\s*>/i', $line)) {
            if (!$hasCsrfInput && !$isGetForm && !$isSuppressed($formStartLine, 'form-missing-csrf')) {
                $issues[] = [
                    'severity' => 'high',
                    'category' => 'template',
                    'pattern' => 'form-missing-csrf',
                    'file' => $relativePath,
                    'line' => $formStartLine,
                    'message' => 'Form is missing CSRF token protection',
                    'suggestion' => 'Add {{ csrfInput() }} inside the form to prevent cross-site request forgery attacks',
                    'code' => $formStartCode,
                ];
            }
            $inFormTag = false;
        }
    }

    // Check for mixed loading strategy (using both .with() and .eagerly() in same file)
    $mixedLine = $withLines[0] ?? 1;
    if ($usesWithInFile && $usesEagerlyInFile && !$isSuppressed($mixedLine, 'mixed-loading-strategy')) {
        $issues[] = [
            'severity' => 'info',
            'category' => 'template',
            'pattern' => 'mixed-loading-strategy',
            'file' => $relativePath,
            'line' => $mixedLine,
            'message' => 'Template uses both .with() and .eagerly() loading strategies',
            'suggestion' => 'Consider using a consistent eager loading strategy. .with() loads upfront, .eagerly() loads lazily on demand (Craft 5+). Using .eagerly() throughout may simplify templates.',
            'code' => "with() on lines: " . implode(', ', $withLines) . " | eagerly() on lines: " . implode(', ', $eagerlyLines),
        ];
    }

    return $issues;
}

function analyzeDirectory(string $directory): array {
    $issues = [];
    
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, RecursiveDirectoryIterator::SKIP_DOTS)
    );
    
    foreach ($iterator as $file) {
        if ($file->isFile() && in_array($file->getExtension(), ['twig', 'html'])) {
            $fileIssues = analyzeFile($file->getPathname(), $directory);
            $issues = array_merge($issues, $fileIssues);
        }
    }
    
    return $issues;
}

// Main execution
if ($argc < 2) {
    fwrite(STDERR, "Usage: php analyze-templates.php <templates-directory>\n");
    exit(1);
}

$templatesDir = $argv[1];

if (!is_dir($templatesDir)) {
    fwrite(STDERR, "Error: Directory not found: {$templatesDir}\n");
    exit(1);
}

$issues = analyzeDirectory($templatesDir);

// Output as JSON
echo json_encode([
    'success' => true,
    'templatesDir' => $templatesDir,
    'issueCount' => count($issues),
    'issues' => $issues,
], JSON_PRETTY_PRINT);
