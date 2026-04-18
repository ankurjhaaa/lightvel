<?php

namespace Lightvel;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\ViewErrorBag;
use Illuminate\Validation\ValidationException;
use ReflectionMethod;
use ReflectionNamedType;

/**
 * Base class for all Lightvel reactive components.
 *
 * A component is defined as an anonymous class inside a Blade file:
 *   new #[Layout('app')] class extends Component { ... }
 *
 * Lifecycle:
 *   1. Compiler.php extracts the class, instantiates it, and calls run()
 *   2. For initial page load (GET): bootLightvel() → lightvel() runs DB queries →
 *      state is serialized into data-light-root attributes → HTML is rendered
 *   3. For AJAX actions (POST with X-Light header): params are merged into state →
 *      the action method is invoked directly → only the result array is returned as JSON
 *
 * The JS runtime (lightvel.js) handles the client-side:
 *   - Sends AJAX POST with {action, params} to the proxy endpoint
 *   - Receives JSON response and updates DOM bindings
 *
 * @see \Lightvel\Support\Blade\Compiler::transform() — boots this class
 * @see \Lightvel\Providers\RouteServiceProvider — handles AJAX proxy routing
 * @see resources/js/lightvel.js — update() function processes the response
 */
class Component
{
    /** @var ViewErrorBag|null Validation error bag for the current request */
    protected ?ViewErrorBag $errorBag = null;

    /** @var array Reactive state — sent to client via data-light-server-state */
    protected array $lightState = [];

    /** @var array Snapshot of state before action, used by getDeltaState() */
    protected array $previousState = [];

    /**
     * Initialize component state by calling the user's lightvel() method.
     *
     * IMPORTANT: This is ONLY called on initial page render (non-AJAX).
     * On AJAX action calls, we skip this entirely to avoid re-running
     * expensive DB queries that produced the initial state.
     *
     * Route parameters (e.g. {id} from /product/{id}) are forwarded
     * as method arguments: lightvel($id) or lightvel($id, $slug).
     *
     * @see lightvel() — user-defined method that returns initial state array
     */
    protected function bootLightvel(array $routeParams = []): void
    {
        if (method_exists($this, 'lightvel')) {
            $result = $this->lightvel(...$routeParams);
            $normalized = $this->normalizeActionResult($result);

            if (is_array($normalized)) {
                $this->mergeResponseData($normalized);
            }
        }
    }

    /**
     * Normalize any action result into a plain array.
     * Supports JsonResponse objects and plain arrays.
     */
    protected function normalizeActionResult(mixed $result): ?array
    {
        if ($result instanceof JsonResponse) {
            $data = $result->getData(true);
            return is_array($data) ? $data : [];
        }

        if (is_array($result)) {
            return $result;
        }

        return null;
    }

    /**
     * Merge response data into reactive state.
     * If the result has a 'data' envelope, unwrap it first.
     */
    protected function mergeResponseData(array $result): void
    {
        if (isset($result['data']) && is_array($result['data'])) {
            $this->setState($result['data']);
            return;
        }

        $this->setState($result);
    }

    /**
     * Set reactive state values.
     * Also sets matching class properties for Blade template access.
     *
     * @param array $data Key-value pairs to merge into state
     */
    public function setState(array $data): void
    {
        $this->lightState = array_merge($this->lightState, $data);

        foreach ($data as $key => $value) {
            if (property_exists($this, $key)) {
                $this->$key = $value;
            }
        }
    }

    /**
     * Get only the state keys that changed since the last snapshot.
     * Used after an action to send only modified data to the JS runtime.
     *
     * @see resources/js/lightvel.js — update() function merges delta into client state
     */
    public function getDeltaState(): array
    {
        $current = $this->getValidationData();
        $delta = [];

        foreach ($current as $key => $value) {
            if (!isset($this->previousState[$key]) || $this->previousState[$key] !== $value) {
                $delta[$key] = $value;
            }
        }

        $this->previousState = $current;
        return $delta;
    }

    /**
     * Access a specific state value or the full state array.
     */
    public function state(?string $key = null, mixed $default = null): mixed
    {
        if ($key === null) {
            return $this->lightState;
        }

        return $this->lightState[$key] ?? $default;
    }

    /**
     * Get validation rules — from rules() method or $rules property.
     * These rules are also sent to the client for client-side validation.
     *
     * @see resources/js/lightvel.js — validateValue() uses these rules client-side
     */
    protected function getRules(): array
    {
        if (method_exists($this, 'rules')) {
            return (array) $this->rules();
        }

        if (property_exists($this, 'rules')) {
            return (array) $this->rules;
        }

        return [];
    }

    /**
     * Rules formatted for the client-side validator.
     * Serialized into data-light-server-rules attribute by Compiler.php.
     */
    public function rulesForClient(): array
    {
        return $this->getRules();
    }

    /**
     * Current state formatted for the client.
     * Serialized into data-light-server-state attribute by Compiler.php.
     */
    public function stateForClient(): array
    {
        return $this->getValidationData();
    }

    /** Get custom validation messages (user-defined $messages property) */
    protected function getMessages(): array
    {
        if (property_exists($this, 'messages')) {
            return (array) $this->messages;
        }

        return [];
    }

    /** Get custom attribute names for validation (user-defined $attributes property) */
    protected function getAttributes(): array
    {
        if (property_exists($this, 'attributes')) {
            return (array) $this->attributes;
        }

        return [];
    }

    /**
     * Get all reactive data for validation.
     * Prefers lightState if populated, otherwise falls back to public class properties.
     * Excludes internal properties (errorBag, rules, messages, etc.).
     */
    protected function getValidationData(): array
    {
        if (!empty($this->lightState)) {
            return $this->lightState;
        }

        $data = get_object_vars($this);

        // Remove internal properties that shouldn't be part of state
        foreach (['errorBag', 'rules', 'messages', 'attributes', 'lightState', 'previousState'] as $key) {
            unset($data[$key]);
        }

        foreach (array_keys($data) as $key) {
            if (str_starts_with($key, '__')) {
                unset($data[$key]);
            }
        }

        return $data;
    }

    /** Get or create the validation error bag */
    public function getErrorBag(): ViewErrorBag
    {
        if (! $this->errorBag) {
            $this->errorBag = new ViewErrorBag();
        }

        return $this->errorBag;
    }

    protected function setErrorBag(ViewErrorBag $bag): void
    {
        $this->errorBag = $bag;
    }

    /**
     * Run Laravel validation against current state.
     * On failure, throws ValidationException which is caught by run()
     * and returned as __lightvel_errors JSON to the client.
     *
     * @see resources/js/lightvel.js — setErrors() renders error messages in the DOM
     */
    public function validate($rules = null, $messages = null, $attributes = null): array
    {
        $validator = Validator::make(
            $this->getValidationData(),
            $rules ?? $this->getRules(),
            $messages ?? $this->getMessages(),
            $attributes ?? $this->getAttributes()
        );

        if ($validator->fails()) {
            $errorBag = new ViewErrorBag();
            $errorBag->put('default', $validator->errors());
            $this->setErrorBag($errorBag);
            throw new ValidationException($validator);
        }

        $this->setErrorBag(new ViewErrorBag());

        return $validator->validated();
    }

    /**
     * Validate a single field only. Used for real-time field validation.
     */
    public function validateOnly(string $field, $rules = null, $messages = null, $attributes = null): array
    {
        $allRules = $rules ?? $this->getRules();
        $onlyRules = [];

        if (isset($allRules[$field])) {
            $onlyRules[$field] = $allRules[$field];
        }

        $validator = Validator::make(
            Arr::only($this->getValidationData(), [$field]),
            $onlyRules,
            $messages ?? $this->getMessages(),
            $attributes ?? $this->getAttributes()
        );

        if ($validator->fails()) {
            $errorBag = new ViewErrorBag();
            $errorBag->put('default', $validator->errors());
            $this->setErrorBag($errorBag);
            throw new ValidationException($validator);
        }

        $this->setErrorBag(new ViewErrorBag());

        return $validator->validated();
    }

    /**
     * Main entry point — called by the compiled Blade template.
     *
     * Two modes:
     *   1. INITIAL RENDER (no X-Light header):
     *      - Runs bootLightvel() to populate state from lightvel()
     *      - Returns all object vars for Blade template extraction via extract()
     *
     *   2. AJAX ACTION (X-Light header present):
     *      - Does NOT call bootLightvel() — avoids re-running DB queries
     *      - Reads action + params from POST body
     *      - Invokes the action method and returns JSON result
     *
     * @param array $routeParams Route parameters (e.g. [42] for /product/{id})
     * @see \Lightvel\Support\Blade\Compiler::transform() — generates the code that calls this
     */
    public function run(array $routeParams = [])
    {
        // --- INITIAL PAGE RENDER ---
        // No X-Light header means this is a normal browser GET request.
        // Boot full state (runs lightvel() which may have DB queries).
        // Route params are forwarded so lightvel($id) receives the {id}.
        if (!request()->header('X-Light')) {
            $this->bootLightvel($routeParams);
            return get_object_vars($this);
        }

        // --- AJAX ACTION REQUEST ---
        // X-Light header is present. Skip bootLightvel() to avoid
        // re-running expensive DB queries — the client already has state.

        // Parse the JSON payload from the request body
        $payload = request()->json()->all();

        if (!is_array($payload) || empty($payload)) {
            $payload = request()->all();
        }

        // Fallback: base64-encoded payload via GET query param (used when POST fails)
        if (isset($payload['_light_payload']) && is_string($payload['_light_payload'])) {
            $decodedRaw = base64_decode($payload['_light_payload'], true);

            if (is_string($decodedRaw) && $decodedRaw !== '') {
                $decoded = json_decode($decodedRaw, true);

                if (is_array($decoded)) {
                    $payload = $decoded;
                }
            }
        }

        $action = $payload['action'] ?? null;
        $params = $payload['params'] ?? [];

        if (is_string($params) && $params !== '') {
            $decodedParams = json_decode($params, true);

            if (json_last_error() === JSON_ERROR_NONE && is_array($decodedParams)) {
                $params = $decodedParams;
            }
        }

        // Build action arguments from params
        $actionArgs = [];

        if (is_array($params)) {
            if (array_is_list($params)) {
                // Positional args: e.g. deleteUser(5) → args = [5]
                $actionArgs = $params;
            } else {
                // Named params: merge into state and request (e.g. form data)
                $this->setState($params);
                request()->merge($params);
                $actionArgs = [];
            }
        }

        // Invoke the action method and return its result as JSON
        try {
            if (
                is_string($action)
                && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $action)
                && !in_array($action, ['run', 'lightvel', 'bootLightvel'], true)
                && method_exists($this, $action)
            ) {
                $result = $this->invokeAction($action, $actionArgs);
                if ($result instanceof JsonResponse) {
                    return $result;
                }

                if ($result !== null) {
                    return response()->json($result);
                }

                return response()->json((object) []);
            }
        } catch (ValidationException $e) {
            // Use $e->errors() — this works with BOTH $this->validate() and $request->validate()
            // $this->getErrorBag() only works when $this->validate() sets it.
            $errors = $e->errors();

            return response()->json([
                'status' => false,
                'message' => 'Validation failed',
                '__lightvel_errors' => $errors,
            ]);
        }

        return response()->json((object) []);
    }

    /**
     * Invoke a component action method with resolved arguments.
     *
     * Uses reflection to:
     *   - Auto-inject Request objects (like Laravel controller methods)
     *   - Pass positional args from the client (e.g. deleteUser(5))
     *   - Fill defaults for optional parameters
     *
     * @param string $action Method name to invoke
     * @param array $actionArgs Positional arguments from the client
     */
    protected function invokeAction(string $action, array $actionArgs): mixed
    {
        $reflection = new ReflectionMethod($this, $action);
        $parameters = $reflection->getParameters();

        // No parameters defined — just spread any positional args
        if (empty($parameters)) {
            return $this->$action(...$actionArgs);
        }

        $resolvedArgs = [];
        $argIndex = 0;

        foreach ($parameters as $parameter) {
            $type = $parameter->getType();

            // Auto-inject Request instance (like Laravel DI)
            if ($type instanceof ReflectionNamedType) {
                $typeName = $type->getName();

                if ($typeName === Request::class || is_subclass_of($typeName, Request::class)) {
                    $resolvedArgs[] = request();
                    continue;
                }
            }

            // Use positional arg from client if available
            if (array_key_exists($argIndex, $actionArgs)) {
                $resolvedArgs[] = $actionArgs[$argIndex];
                $argIndex++;
                continue;
            }

            // Fall back to parameter default value
            if ($parameter->isDefaultValueAvailable()) {
                $resolvedArgs[] = $parameter->getDefaultValue();
                continue;
            }

            $resolvedArgs[] = null;
        }

        return $this->$action(...$resolvedArgs);
    }
}
