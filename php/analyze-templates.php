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

// Deprecated patterns in Craft 4/5
$DEPRECATED_PATTERNS = [
    [
        'pattern' => '/craft\.request\./',
        'message' => 'craft.request is deprecated',
        'suggestion' => 'Use craft.app.request instead',
    ],
    [
        'pattern' => '/\|date_modify\b/',
        'message' => '|date_modify filter is deprecated',
        'suggestion' => 'Use |date_modify or native Twig date functions',
    ],
    [
        'pattern' => '/getUrl\(\)/',
        'message' => 'getUrl() is deprecated for assets',
        'suggestion' => 'Use .url property instead',
    ],
    [
        'pattern' => '/craft\.config\./',
        'message' => 'craft.config is deprecated',
        'suggestion' => 'Use craft.app.config.general instead',
    ],
    [
        'pattern' => '/{% includeJsFile/',
        'message' => 'includeJsFile tag is deprecated',
        'suggestion' => 'Use craft.app.view.registerJsFile() instead',
    ],
    [
        'pattern' => '/{% includeCssFile/',
        'message' => 'includeCssFile tag is deprecated', 
        'suggestion' => 'Use craft.app.view.registerCssFile() instead',
    ],
];

function analyzeFile(string $filePath, string $basePath): array {
    global $QUERY_PATTERNS, $MISSING_LIMIT_QUERY_PATTERNS, $NARROWING_QUERY_METHODS, $RELATION_FIELD_METHODS, $DEPRECATED_PATTERNS;
    
    $issues = [];
    $content = file_get_contents($filePath);
    $lines = explode("\n", $content);
    $relativePath = str_replace($basePath . '/', '', $filePath);
    
    // Track context
    $inForLoop = false;
    $forLoopStart = 0;
    $forLoopVar = '';
    $forLoopQueryLine = 0;
    $hasEagerLoading = false;
    $queryAssignments = [];
    $seenRelationIssues = [];

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

                    if (!$hasTerminalLimiter && !$hasNarrowingMethod) {
                        $issues[] = [
                            'severity' => 'medium',
                            'category' => 'template',
                            'pattern' => 'missing-limit',
                            'file' => $relativePath,
                            'line' => $forLoopQueryLine,
                            'message' => 'Query in loop without .limit() may fetch too many results',
                            'suggestion' => 'Add .limit(n) to paginate results',
                            'code' => trim($querySource),
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

                        $issues[] = [
                            'severity' => 'high',
                            'category' => 'template',
                            'pattern' => 'n+1',
                            'file' => $relativePath,
                            'line' => $lineNumber,
                            'message' => "Potential N+1 query: {$forLoopVar}.{$fieldName}" . str_replace('\\', '', $method) . " inside loop",
                            'suggestion' => "Add .with(['{$fieldName}']) to the query on line " . ($forLoopQueryLine ?: $forLoopStart),
                            'code' => trim($line),
                        ];
                    }
                }
            }
            
            // Check for .eagerly() usage (Craft 5 lazy eager loading)
            if (preg_match('/' . preg_quote($forLoopVar, '/') . '\.(\w+)\.eagerly\(\)/', $line)) {
                // This is good - they're using lazy eager loading
                continue;
            }
        }
        
        // Check for deprecated patterns
        foreach ($DEPRECATED_PATTERNS as $deprecated) {
            if (preg_match($deprecated['pattern'], $line)) {
                $issues[] = [
                    'severity' => 'medium',
                    'category' => 'template',
                    'pattern' => 'deprecated',
                    'file' => $relativePath,
                    'line' => $lineNumber,
                    'message' => $deprecated['message'],
                    'suggestion' => $deprecated['suggestion'],
                    'code' => trim($line),
                ];
            }
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
