<?php

namespace Lightvel\Providers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

/**
 * Registers Lightvel routes:
 *   1. Route::lightvel() macro — for defining component page routes
 *   2. AJAX proxy endpoints — handle component action calls from the JS runtime
 *
 * How AJAX actions work:
 *   Browser (lightvel.js sendLightAction)
 *     → POST /lightvel-{fingerprint}/update  (or /lightvel/message)
 *     → This provider forwards the request internally to the original page route
 *     → Component.php::run() handles the action and returns JSON
 *     → JSON response goes back to lightvel.js update() function
 *
 * Debugbar compatibility:
 *   The internal forward uses app()->handle() which creates a sub-request.
 *   We set the route name on the forwarded request so debugbar can identify it.
 *
 * @see \Lightvel\Component::run() — processes the action on the server side
 * @see resources/js/lightvel.js — sendLightAction() sends the AJAX request
 */
class RouteServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // ------------------------------------------------------------------
        // Route::lightvel() macro — register a route that renders a Lightvel Blade view
        //
        // Usage:
        //   Route::lightvel('/dashboard', 'pages.dashboard');
        //   Route::lightvel('/users', 'pages.users', ['GET', 'POST']);
        //
        // The route supports both GET (initial page load) and POST (AJAX actions).
        // POST requests with X-Light header are handled as component actions.
        // ------------------------------------------------------------------
        Route::macro('lightvel', function (string $uri, string $view, array|string|null $methods = null) {
            $handler = function () use ($view) {
                $html = view($view)->render();

                return response($html, 200, [
                    'Content-Type' => 'text/html; charset=UTF-8',
                ]);
            };

            if ($methods === null) {
                // Default: accept any HTTP method (GET for page, POST for actions)
                $route = Route::any($uri, $handler);
            } else {
                $methodList = is_string($methods)
                    ? array_values(array_filter(array_map('trim', preg_split('/[\s,|]+/', $methods) ?: [])))
                    : array_values(array_filter(array_map('trim', $methods)));

                if (empty($methodList)) {
                    $methodList = ['GET'];
                }

                $route = Route::match($methodList, $uri, $handler);
            }

            // Store view name in route action for Compiler.php to resolve later
            $route->setAction(array_merge($route->getAction(), [
                'view' => $view,
            ]));

            return $route;
        });

        // ------------------------------------------------------------------
        // AJAX proxy handler — receives action calls from lightvel.js
        //
        // Flow:
        //   1. JS sends POST with {url, action, params, component, fingerprint}
        //   2. We create an internal Request to the original page URL
        //   3. The internal request has X-Light headers so Component::run()
        //      knows to handle it as an AJAX action (skips bootLightvel)
        //   4. Response JSON is passed back to the browser
        //
        // Why internal forwarding? Because the Blade view defines the component
        // class inline — we need the Blade compilation to instantiate it. But
        // Component::run() skips bootLightvel() on AJAX, so it's fast.
        //
        // Debugbar fix: We set proper route name on the forwarded request so
        // laravel-debugbar shows the actual route instead of "nahi hai pas post/"
        // ------------------------------------------------------------------
        $handler = function (Request $request) {
            $targetUrl = (string) $request->input('url', url()->current());
            $parsedTarget = parse_url($targetUrl);
            $parsedCurrent = parse_url(url()->current());

            // Security: reject cross-origin requests
            if (
                isset($parsedTarget['host'], $parsedCurrent['host'])
                && strcasecmp($parsedTarget['host'], $parsedCurrent['host']) !== 0
            ) {
                return response()->json([
                    'status' => false,
                    'message' => 'Invalid target host.',
                ], 422);
            }

            $path = $parsedTarget['path'] ?? '/';

            $query = [];
            if (! empty($parsedTarget['query'])) {
                parse_str($parsedTarget['query'], $query);
            }

            $action = $request->input('action', '');
            $params = $request->input('params', []);

            $payload = [
                'action' => $action,
                'params' => $params,
            ];

            $component = (string) $request->header('X-Light-Component', (string) $request->input('component', ''));
            $fingerprint = (string) $request->header('X-Light-Fingerprint', (string) $request->input('fingerprint', ''));

            // Build server vars for the internal request forwarding
            $server = $request->server->all();
            $server['REQUEST_METHOD'] = 'POST';
            $server['CONTENT_TYPE'] = 'application/json';
            $server['HTTP_ACCEPT'] = 'application/json';
            $server['HTTP_X_REQUESTED_WITH'] = 'XMLHttpRequest';
            $server['HTTP_X_LIGHT'] = 'true';
            $server['HTTP_X_LIGHT_FORWARDED'] = 'true';
            $server['HTTP_X_LIGHT_COMPONENT'] = $component;
            $server['HTTP_X_LIGHT_FINGERPRINT'] = $fingerprint;

            // Set REQUEST_URI so that debugbar and other tools can identify the route
            $forwardUri = $path . (empty($query) ? '' : '?' . http_build_query($query));
            $server['REQUEST_URI'] = $forwardUri;

            // Create internal request to the original page route
            $forward = Request::create(
                $forwardUri,
                'POST',
                [],
                $request->cookies->all(),
                [],
                $server,
                json_encode($payload)
            );

            // Set headers that Component::run() checks to know this is an AJAX action
            $forward->headers->set('X-Light', 'true');
            $forward->headers->set('X-Light-Forwarded', 'true');
            $forward->headers->set('X-Light-Action', $action);
            $forward->headers->set('X-Requested-With', 'XMLHttpRequest');
            $forward->headers->set('Accept', 'application/json');

            // Dispatch the internal request through Laravel's kernel
            $response = app()->handle($forward);

            // Fallback: if POST returns 404/405, retry as GET with base64 payload
            // This handles routes that only accept GET (e.g. Route::get())
            if (in_array($response->getStatusCode(), [404, 405], true)) {
                $query['_light_payload'] = base64_encode(json_encode($payload));

                $server['REQUEST_METHOD'] = 'GET';
                unset($server['CONTENT_TYPE']);
                $fallbackUri = $path . '?' . http_build_query($query);
                $server['REQUEST_URI'] = $fallbackUri;

                $fallback = Request::create(
                    $fallbackUri,
                    'GET',
                    [],
                    $request->cookies->all(),
                    [],
                    $server,
                    null
                );

                $fallback->headers->set('X-Light', 'true');
                $fallback->headers->set('X-Light-Forwarded', 'true');
                $fallback->headers->set('X-Light-Action', $action);
                $fallback->headers->set('X-Requested-With', 'XMLHttpRequest');
                $fallback->headers->set('Accept', 'application/json');

                $response = app()->handle($fallback);
            }

            // Return the JSON response to the client
            if ($response instanceof \Illuminate\Http\JsonResponse) {
                return $response;
            }

            $status = $response->getStatusCode();
            $contentType = strtolower((string) $response->headers->get('Content-Type', ''));
            $content = (string) $response->getContent();

            // Try to decode JSON from the response content
            if ($content !== '' && str_contains($contentType, 'application/json')) {
                $decoded = json_decode($content, true);

                if (is_array($decoded)) {
                    return response()->json($decoded, $status);
                }
            }

            // Even if Content-Type isn't JSON, try parsing — Component::run() may
            // have output JSON via echo without setting proper headers
            if ($content !== '') {
                $decoded = json_decode($content, true);

                if (is_array($decoded)) {
                    return response()->json($decoded, $status);
                }
            }

            if ($status >= 400) {
                return response()->json([
                    'status' => false,
                    'message' => 'Lightvel action failed.',
                ], $status);
            }

            return response()->json([], $status);
        };

        // ------------------------------------------------------------------
        // Register AJAX proxy routes
        //
        // Two endpoints for flexibility:
        //   /lightvel/message — generic endpoint (configurable via config)
        //   /lightvel-{fingerprint}/update — component-specific endpoint
        //
        // The JS runtime uses the fingerprint-based endpoint by default
        // (set in data-light-endpoint attribute by Compiler.php)
        // ------------------------------------------------------------------
        Route::middleware('web')
            ->post(config('lightvel.message_endpoint', '/lightvel/message'), $handler)
            ->name('lightvel.message');

        Route::middleware('web')
            ->post('/lightvel-{fingerprint}/update', $handler)
            ->where('fingerprint', '[A-Za-z0-9]+')
            ->name('lightvel.component.update');
    }
}
