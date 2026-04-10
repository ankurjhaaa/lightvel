<?php

namespace Lightvel\Providers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

class RouteServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Route::middleware('web')->post(config('lightvel.message_endpoint', '/lightvel/message'), function (Request $request) {
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

            $query['_light_payload'] = base64_encode(json_encode($payload));

            $forward = Request::create(
                $path . '?' . http_build_query($query),
                'GET',
                [],
                $request->cookies->all(),
                [],
                $request->server->all(),
                null
            );

            $forward->headers->set('X-Light', 'true');
            $forward->headers->set('X-Light-Forwarded', 'true');
            $forward->headers->set('Accept', 'application/json');

            $response = app()->handle($forward);

            return $response;
        })->name('lightvel.message');
    }
}
