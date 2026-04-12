<?php

namespace Lightvel\Support\Debug;

use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use stdClass;
use Throwable;

class Collector
{
    protected static ?self $instance = null;

    protected static bool $listening = false;

    protected float $startedAt;

    protected string $requestId;

    protected array $views = [];

    protected array $messages = [];

    protected array $errors = [];

    protected array $queries = [];

    protected array $models = [];

    protected array $queryHashes = [];

    protected ?string $routeName = null;

    protected ?string $routeUri = null;

    protected ?string $routeMethod = null;

    protected ?string $routeAction = null;

    protected ?string $requestPath = null;

    protected ?string $requestUrl = null;

    protected function __construct()
    {
        $this->startedAt = microtime(true);
        $this->requestId = substr(sha1((string) $this->startedAt . '|' . random_int(1, PHP_INT_MAX)), 0, 12);

        $request = request();
        $this->requestPath = $request?->path();
        $this->requestUrl = $request?->fullUrl();

        $route = $request?->route();
        if ($route) {
            $this->routeName = $route->getName();
            $this->routeUri = method_exists($route, 'uri') ? $route->uri() : null;
            $this->routeMethod = method_exists($route, 'methods') ? implode(', ', $route->methods()) : null;
            $action = $route->getAction();
            $this->routeAction = is_array($action) && isset($action['view']) ? (string) $action['view'] : null;
        }

        $this->listenForQueries();
    }

    public static function boot(): self
    {
        if (! config('app.debug')) {
            return static::instance();
        }

        if (! static::$instance) {
            static::$instance = new self();
        }

        return static::$instance;
    }

    public static function instance(): self
    {
        if (! static::$instance) {
            static::$instance = new self();
        }

        return static::$instance;
    }

    protected function listenForQueries(): void
    {
        if (static::$listening) {
            return;
        }

        static::$listening = true;

        DB::listen(function (QueryExecuted $query) {
            $sql = $this->interpolateQuery($query->sql, $query->bindings);
            $key = md5($query->sql . '|' . json_encode($query->bindings));

            $this->queries[] = [
                'sql' => $sql,
                'raw_sql' => $query->sql,
                'bindings' => array_values($query->bindings),
                'time_ms' => (float) $query->time,
                'connection' => $query->connectionName,
            ];

            $this->queryHashes[$key] = ($this->queryHashes[$key] ?? 0) + 1;
        });
    }

    public function recordView(string $name, float $durationMs = 0.0): void
    {
        $this->views[] = [
            'name' => $name,
            'time_ms' => round($durationMs, 2),
        ];
    }

    public function message(string $message, string $level = 'info'): void
    {
        $this->messages[] = [
            'level' => $level,
            'message' => $message,
            'time' => now()->toDateTimeString(),
        ];
    }

    public function captureValue(mixed $value): void
    {
        if ($value instanceof Model || $value instanceof stdClass) {
            $class = get_class($value);
            $this->models[$class] = ($this->models[$class] ?? 0) + 1;
            return;
        }

        if (is_array($value)) {
            foreach ($value as $item) {
                $this->captureValue($item);
            }

            return;
        }

        if (is_object($value)) {
            $class = get_class($value);
            $this->models[$class] = ($this->models[$class] ?? 0) + 1;

            foreach (get_object_vars($value) as $item) {
                $this->captureValue($item);
            }
        }
    }

    public function error(Throwable|string $error): void
    {
        $this->errors[] = is_string($error)
            ? [
                'message' => $error,
                'class' => null,
                'file' => null,
                'line' => null,
                'trace' => [],
            ]
            : [
                'message' => $error->getMessage(),
                'class' => get_class($error),
                'file' => $error->getFile(),
                'line' => $error->getLine(),
                'trace' => collect($error->getTrace())->take(12)->map(function ($frame) {
                    return [
                        'file' => $frame['file'] ?? null,
                        'line' => $frame['line'] ?? null,
                        'function' => $frame['function'] ?? null,
                        'class' => $frame['class'] ?? null,
                    ];
                })->all(),
            ];
    }

    public function flushFromException(Throwable $e): void
    {
        $this->error($e);
    }

    public function duplicateQueries(): array
    {
        $duplicates = [];

        foreach ($this->queryHashes as $hash => $count) {
            if ($count <= 1) {
                continue;
            }

            $duplicates[] = [
                'count' => $count,
                'query' => $this->queriesByHash($hash)['sql'] ?? null,
            ];
        }

        return $duplicates;
    }

    protected function queriesByHash(string $hash): ?array
    {
        $query = $this->queries[array_search($hash, array_map(function ($item) {
            return md5($item['raw_sql'] . '|' . json_encode($item['bindings']));
        }, $this->queries), true)] ?? null;

        return is_array($query) ? $query : null;
    }

    public function payload(): array
    {
        $durationMs = (microtime(true) - $this->startedAt) * 1000;
        $memoryUsed = memory_get_usage(true);
        $memoryPeak = memory_get_peak_usage(true);

        return [
            'request' => [
                'id' => $this->requestId,
                'url' => $this->requestUrl,
                'path' => $this->requestPath,
                'method' => request()?->method(),
                'route_method' => $this->routeMethod,
                'route_name' => $this->routeName,
                'route_uri' => $this->routeUri,
                'route_view' => $this->routeAction,
                'ip' => request()?->ip(),
            ],
            'timeline' => [
                'duration_ms' => round($durationMs, 2),
                'memory_used_mb' => round($memoryUsed / 1024 / 1024, 2),
                'memory_peak_mb' => round($memoryPeak / 1024 / 1024, 2),
                'views_count' => count($this->views),
                'queries_count' => count($this->queries),
            ],
            'views' => $this->views,
            'queries' => $this->queries,
            'models' => array_map(fn ($class, $count) => [
                'class' => $class,
                'count' => $count,
            ], array_keys($this->models), $this->models),
            'duplicate_queries' => $this->duplicateQueries(),
            'messages' => $this->messages,
            'errors' => $this->errors,
        ];
    }

    public function hasErrors(): bool
    {
        return ! empty($this->errors);
    }

    protected function interpolateQuery(string $sql, array $bindings): string
    {
        foreach ($bindings as $binding) {
            $replacement = is_numeric($binding)
                ? (string) $binding
                : ("'" . str_replace("'", "\\'", (string) $binding) . "'");

            $sql = preg_replace('/\?/', $replacement, $sql, 1);
        }

        return $sql;
    }
}