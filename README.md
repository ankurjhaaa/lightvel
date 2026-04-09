# Lightvel

Lightvel is a lightweight reactive layer for Laravel Blade pages.

It gives you:

- server-side component actions using plain PHP classes in Blade
- client-side state helpers for common UI behavior
- minimal runtime with fast DOM updates
- simple setup commands

## Author

- Ankur Jha
- GitHub: https://github.com/ankurjhaaa

## License

This package is open-sourced software licensed under the MIT license.
See [LICENSE](LICENSE).

---

## Installation

```bash
composer require lightvel/lightvel
php artisan lightvel:install
```

`lightvel:install` publishes:

- `config/lightvel.php`
- `public/vendor/lightvel/lightvel.js`

---

## Quick Start

### 1) Create layout

```bash
php artisan lightvel:layout app
```

Creates:

```text
resources/views/layouts/app.blade.php
```

### 2) Create page

```bash
php artisan make:lightvel pages::home
```

Creates:

```text
resources/views/pages/home.blade.php
```

### 3) Add route (GET + POST)

Lightvel actions use POST on the same URL.

```php
use Illuminate\Support\Facades\Route;

Route::match(['GET', 'POST'], '/', function () {
    return view('pages.home');
});
```

### 4) Ensure layout has `@lightScripts`

```blade
<meta name="csrf-token" content="{{ csrf_token() }}">
...
@lightScripts
```

---

## Server-side Component Example

```blade
@php
use Lightvel\Component;
use Lightvel\Layout;

new #[Layout('app')] class extends Component {
    public $count = 0;

    public function increment() { $this->count++; }
    public function decrement() { $this->count--; }
};
@endphp

<div>
    <button light:click="decrement">-</button>
    <span light:bind="count">{{ $count }}</span>
    <button light:click="increment">+</button>
</div>
```

---

## Directives

### Server directives

- `light:model="field"` → bind input value to server property
- `light:click="method"` → call server method
- `light:submit="method"` → submit form to server method
- `light:bind="field"` → update text content from server state
- `light:html="field"` → update HTML content from server state
- `light:navigate` on `<a>` → SPA-like navigation without full refresh
- `light:error="field"` → render first validation error for field
- `light:error-message="Text"` → custom fallback message

### Client directives

- `light:js:init="{...}"` → initialize client state
- `light:js:model="field"` → bind input to client state
- `light:js:bind="field"` → bind text to client state
- `light:js:html="field"` → bind HTML to client state
- `light:js:click="action(...)"` → call client action
- `light:js:submit="action(...)"` → call client action on submit
- `light:js:show="expr"` → show/hide based on expression
- `light:js:class="{'class-name': expr}"` → conditional class toggling
- `light:js:rules="required|min:3"` → client-side validation rules

---

## Built-in Client Actions

`light:js:click` supports these built-ins:

- `toggle(field)`
- `inc(field, step)`
- `dec(field, step)`

Example:

```blade
<div light:js:init="{'count': 0, 'open': false}">
    <button light:js:click="dec(count, 5)">-5</button>
    <span light:js:bind="count"></span>
    <button light:js:click="inc(count, 5)">+5</button>

    <button light:js:click="toggle(open)">Toggle</button>
    <div light:js:show="open">Visible when open is true</div>
</div>
```

---

## Validation

Use Laravel-style rules on component:

```php
protected $rules = [
    'name' => 'required|min:3',
    'email' => 'required|email',
];
```

Run on action:

```php
public function save()
{
    $this->validate();
}
```

Blade usage:

```blade
<input light:model="name" light:js:rules="required|min:3">
<span light:error="name"></span>
```

Validation runs in two layers:

1. Client-side (fast block before request)
2. Server-side (authoritative Laravel validation)

---

## Navigation

Use `light:navigate` on internal links:

```blade
<a href="/" light:navigate>Home</a>
<a href="/about" light:navigate>About</a>
```

Features:

- no full page reload
- browser history support (`back`/`forward`)
- top progress bar

Progress bar color is configurable:

```env
LIGHTVEL_PROGRESS_BAR_COLOR="#22c55e"
```

---

## Configuration

`config/lightvel.php`:

- `default_layout` → fallback layout name
- `layout_folder` → layout folder under `resources/views`
- `view_root` → optional subfolder under `resources/views` for generated pages
- `script_path` → runtime JS path fallback
- `progress_bar_color` → navigation progress bar color

---

## Common Troubleshooting

### 405 Method Not Allowed on `light:click`

Route must allow POST:

```php
Route::match(['GET', 'POST'], '/your-page', fn () => view('...'));
```

### Action not firing

Check layout has:

- `<meta name="csrf-token" content="{{ csrf_token() }}">`
- `@lightScripts`

### Stale behavior after package update

Run:

```bash
php artisan optimize:clear
```

---

## Notes

- Recommended page generation command is `php artisan make:lightvel pages::home`.
