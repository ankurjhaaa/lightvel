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
            // Handler captures route parameters and passes to view
            $handler = function () use ($view) {
                // Collect route parameters (e.g. {id}, {slug}) for lightvel($id) support
                $routeParams = array_values(request()->route()?->parameters() ?? []);
                $html = view($view, ['__lightvel_params' => $routeParams])->render();

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
            $action = $request->input('action', '');
            $params = $request->input('params', []);

            // Match the target URL to a registered route to find the view name
            $fakeRequest = Request::create($path, 'GET');
            try {
                $matchedRoute = app('router')->getRoutes()->match($fakeRequest);
            } catch (\Throwable $e) {
                return response()->json([
                    'status' => false,
                    'message' => 'Route not found.',
                ], 404);
            }

            $viewName = $matchedRoute->getAction()['view'] ?? null;
            if (!$viewName) {
                return response()->json([
                    'status' => false,
                    'message' => 'Not a Lightvel route.',
                ], 422);
            }

            // Get route parameters (e.g. {id}, {slug})
            $routeParams = array_values($matchedRoute->parameters() ?? []);

            // Set X-Light headers on the CURRENT request so Component::run()
            // detects AJAX mode — no internal forwarding needed.
            $originalHeaders = [
                'X-Light' => $request->headers->get('X-Light'),
                'X-Light-Action' => $request->headers->get('X-Light-Action'),
                'Content-Type' => $request->headers->get('Content-Type'),
            ];

            $request->headers->set('X-Light', 'true');
            $request->headers->set('X-Light-Action', $action);
            $request->headers->set('Content-Type', 'application/json');

            // Merge action payload into the request so Component::run() can read it
            $request->merge([
                'action' => $action,
                'params' => $params,
            ]);

            // Set JSON content for Component::run() to parse
            $request->json()->replace([
                'action' => $action,
                'params' => $params,
            ]);

            try {
                // Render the view directly — Component::run() handles the AJAX action
                // during Blade compilation. No Router::dispatch = no duplicate middleware.
                $html = view($viewName, ['__lightvel_params' => $routeParams])->render();
            } catch (\Throwable $e) {
                // Restore headers
                foreach ($originalHeaders as $key => $val) {
                    if ($val !== null) {
                        $request->headers->set($key, $val);
                    } else {
                        $request->headers->remove($key);
                    }
                }

                throw $e;
            }

            // Restore original headers
            foreach ($originalHeaders as $key => $val) {
                if ($val !== null) {
                    $request->headers->set($key, $val);
                } else {
                    $request->headers->remove($key);
                }
            }

            // Component::run() returns JSON for AJAX requests.
            // The view rendering captures this as HTML content, but the actual
            // JSON response was already sent by Component. Try to extract it.
            $decoded = json_decode($html, true);
            if (is_array($decoded)) {
                return response()->json($decoded);
            }

            // Sometimes the response is embedded in HTML wrappers
            $html = trim($html);
            if ($html !== '' && $html[0] === '{') {
                $decoded = json_decode($html, true);
                if (is_array($decoded)) {
                    return response()->json($decoded);
                }
            }

            return response()->json((object) []);
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
