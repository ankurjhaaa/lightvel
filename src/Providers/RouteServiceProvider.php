<?php

namespace Lightvel\Providers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

class RouteServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $handler = function (Request $request) {
            $targetUrl = (string) $request->input('url', url()->current());
            $parsedTarget = parse_url($targetUrl);
            $parsedCurrent = parse_url(url()->current());

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

            $payload = [
                'action' => $request->input('action'),
                'params' => $request->input('params', []),
            ];

            $component = (string) $request->header('X-Light-Component', (string) $request->input('component', ''));
            $fingerprint = (string) $request->header('X-Light-Fingerprint', (string) $request->input('fingerprint', ''));

            if (app()->bound('debugbar')) {
                try {
                    app('debugbar')->addMessage('lightvel component ' . ($component ?: 'unknown') . ' #' . ($fingerprint ?: 'n/a'), 'lightvel');
                } catch (\Throwable $e) {
                }
            }

            $server = $request->server->all();
            $server['REQUEST_METHOD'] = 'POST';
            $server['CONTENT_TYPE'] = 'application/json';
            $server['HTTP_ACCEPT'] = 'application/json';
            $server['HTTP_X_LIGHT'] = 'true';
            $server['HTTP_X_LIGHT_FORWARDED'] = 'true';
            $server['HTTP_X_LIGHT_COMPONENT'] = $component;
            $server['HTTP_X_LIGHT_FINGERPRINT'] = $fingerprint;

            $forward = Request::create(
                $path . (empty($query) ? '' : '?' . http_build_query($query)),
                'POST',
                [],
                $request->cookies->all(),
                [],
                $server,
                json_encode($payload)
            );

            $forward->headers->set('X-Light', 'true');
            $forward->headers->set('X-Light-Forwarded', 'true');
            $forward->headers->set('Accept', 'application/json');

            $response = app()->handle($forward);

            if (in_array($response->getStatusCode(), [404, 405], true)) {
                $query['_light_payload'] = base64_encode(json_encode($payload));

                $server['REQUEST_METHOD'] = 'GET';
                unset($server['CONTENT_TYPE']);

                $fallback = Request::create(
                    $path . '?' . http_build_query($query),
                    'GET',
                    [],
                    $request->cookies->all(),
                    [],
                    $server,
                    null
                );

                $fallback->headers->set('X-Light', 'true');
                $fallback->headers->set('X-Light-Forwarded', 'true');
                $fallback->headers->set('Accept', 'application/json');

                $response = app()->handle($fallback);
            }

            if ($response instanceof \Illuminate\Http\JsonResponse) {
                return $response;
            }

            $content = $response->getContent();
            $data = is_string($content) && !empty($content) ? json_decode($content, true) : [];

            if (!is_array($data)) {
                $data = [];
            }

            return response()->json($data);
        
        };

        Route::middleware('web')
            ->post(config('lightvel.message_endpoint', '/lightvel/message'), $handler)
            ->name('lightvel.message');

        Route::middleware('web')
            ->post('/lightvel-{fingerprint}/update', $handler)
            ->where('fingerprint', '[A-Za-z0-9]+')
            ->name('lightvel.component.update');
    }
}
