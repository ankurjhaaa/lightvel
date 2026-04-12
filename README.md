# Lightvel

Lightvel is a lightweight reactive layer for Laravel Blade pages.

It keeps Laravel-style request/response flow and adds simple reactive state in Blade.

## Installation

```bash
composer require lightvel/lightvel
php artisan lightvel:install
```

## Route Style

```php
use Illuminate\Support\Facades\Route;

Route::lightvel('/', 'pages.home')->name('home');
```

## Basic Page

```blade
@php
use Lightvel\Component;
use Lightvel\Layout;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {
    public function lightvel(): array
    {
        return [
            'count' => 0,
            'message' => '',
        ];
    }

    public function increment(Request $request): array
    {
        $count = (int) $request->input('count', 0) + 1;
        return ['count' => $count];
    }
};
@endphp

<div light:state='{"count":0,"message":""}'>
    <button light:click="increment">+</button>
    <span light:text="count"></span>
</div>
```

## Supported Directives (Current)

These directives are currently mapped and supported in this package:

- `light:state`
- `light:model`
- `light:model.live`
- `light:click`
- `light:submit`
- `light:text`
- `light:if`
- `light:show`
- `light:for`
- `light:class`
- `light:const`
- `light:function`
- `light:rules`
- `light:debounce`
- `light:error`
- `light:error-message`
- `light:navigate`

## Validation Flow

Lightvel validation runs in 2 steps:

1. **Client-side (live)** using `light:rules` for quick checks.
2. **Server-side (submit/live action)** using Laravel validation for final checks like `unique`, `exists`, etc.

### Client-side Example

```blade
<input name="name" light:model="name" light:rules="required|min:3|max:100" />
<span light:error="name"></span>
```

### Server-side Example

```php
use Illuminate\Http\Request;

public function store(Request $request): array
{
    $validated = $request->validate([
        'name' => ['required', 'min:3', 'max:100'],
        'email' => ['required', 'email', 'unique:users,email'],
    ]);

    // Save and return updated state
    return ['message' => 'Saved'];
}
```

Server validation errors are rendered in the same `light:error` field slots.

## `light:model` vs `light:model.live`

- `light:model`: only updates client state.
- `light:model.live`: updates client state and triggers nearest `form[light:submit]` action (debounced if set).

## Performance Notes

- Input syncing is frame-batched to reduce typing lag.
- Prefer `light:model.live` only where live server interaction is needed.
- Keep heavy `light:for` sections scoped to only required state keys.

## Troubleshooting

### Action not firing

Ensure layout has:

```blade
<meta name="csrf-token" content="{{ csrf_token() }}">
@lightScripts
```

### 405 errors

Use Lightvel route macro format:

```php
Route::lightvel('/path', 'pages.example')->name('example');
```

### After update

```bash
php artisan optimize:clear
```

## License

MIT
