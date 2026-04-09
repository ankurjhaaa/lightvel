# Lightvel

Lightvel is a lightweight Laravel reactive package inspired by Livewire.

It is made for developers who want:

- simple Blade-based pages
- small payloads
- fast UI updates
- easy command-based file generation

## Author

- Ankur Jha
- GitHub: https://github.com/ankurjhaaa

## License

This package is open-sourced software licensed under the MIT license.
See [LICENSE](LICENSE).

## Install

```bash
composer require lightvel/lightvel
php artisan lightvel:install
```

## How to use

### 1) Create a layout

```bash
php artisan lightvel:layout app
```

This creates a layout file at:

```text
resources/views/layouts/app.blade.php
```

You can also create custom layouts like:

```bash
php artisan lightvel:layout components.layout.admin
```

### 2) Create a Lightvel page

```bash
php artisan make:lightvel pages::app.home
```

This creates a page file at:

```text
resources/views/pages/app/home.blade.php
```

You can also use:

```bash
php artisan lightvel:component pages::app.home
```

Both commands generate a starter page with:

- a component class
- a `lightvel()` loader method
- a sample action method
- a status field
- a working `light:click` example

### 3) Write your page

Example:

```blade
@php

use Lightvel\Component;
use Lightvel\Layout;

new #[Layout('app')] class extends Component {
    public $name = '';
    public $status = 'Ready';

    public function lightvel()
    {
        // load initial data here
    }

    public function save()
    {
        $this->status = 'Saved';
    }
};

@endphp

<div>
    <h2 light:bind="status">{{ $status }}</h2>
    <input type="text" light:model="name">
    <button light:click="save">Save</button>
</div>
```

## Current features

- `light:model` for two-way form fields
- `light:click` for action calls
- `light:submit` for form submits
- `light:bind` for text updates
- `light:html` for HTML updates
- `#[Layout('...')]` support for layout selection
- default fallback layout support
- JSON-based request handling
- frontend DOM patching for fast updates
- publishable config
- publishable JavaScript runtime
- install command for setup

## Important notes

- No component is created automatically.
- You create pages/components only when you run the command.
- Layout name `app` resolves to `resources/views/layouts/app.blade.php`.
- Dotted layout names like `components.layout.admin` also work.
- If no layout is provided, Lightvel uses the default layout from config.

## Example workflow

1. Run `php artisan lightvel:layout app`
2. Run `php artisan make:lightvel pages::app.home`
3. Edit the generated page
4. Use `light:model`, `light:click`, and `light:submit`
5. Keep your actions inside the page class

## Install command publishes

- config/lightvel.php
- Lightvel JavaScript runtime

## Packagist publishing

After the package is ready:

1. push it to GitHub
2. tag a release
3. submit it to Packagist
4. users can install it with `composer require lightvel/lightvel`

## Versioning idea

Keep the first public release simple:

- core reactive page support
- layout support
- commands
- runtime JS
- config file

Later you can add:

- validation helpers
- exception handling
- events
- file upload support
- pagination
- JS plugins
