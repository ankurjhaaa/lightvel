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

class Component
{
    protected ?ViewErrorBag $errorBag = null;
    protected array $lightState = [];
    protected array $previousState = [];

    protected function bootLightvel(): void
    {
        if (method_exists($this, 'lightvel')) {
            $result = $this->lightvel();
            $normalized = $this->normalizeActionResult($result);

            if (is_array($normalized)) {
                $this->mergeResponseData($normalized);
            }
        }
    }

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

    protected function isEnvelopeResponse(array $result): bool
    {
        return array_key_exists('status', $result)
            || array_key_exists('message', $result)
            || array_key_exists('data', $result)
            || array_key_exists('errors', $result);
    }

    protected function mergeResponseData(array $result): void
    {
        if (isset($result['data']) && is_array($result['data'])) {
            $this->setState($result['data']);
            return;
        }

        $this->setState($result);
    }

    public function setState(array $data): void
    {
        $this->lightState = array_merge($this->lightState, $data);

        foreach ($data as $key => $value) {
            if (property_exists($this, $key)) {
                $this->$key = $value;
            }
        }
    }

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

    public function getResponse(mixed $data = null): array
    {
        if ($data === null) {
            return [];
        }

        if (is_array($data)) {
            return $data;
        }

        return [];
    }

    public function state(?string $key = null, mixed $default = null): mixed
    {
        if ($key === null) {
            return $this->lightState;
        }

        return $this->lightState[$key] ?? $default;
    }

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

    public function rulesForClient(): array
    {
        return $this->getRules();
    }

    public function stateForClient(): array
    {
        return $this->getValidationData();
    }

    protected function getMessages(): array
    {
        if (property_exists($this, 'messages')) {
            return (array) $this->messages;
        }

        return [];
    }

    protected function getAttributes(): array
    {
        if (property_exists($this, 'attributes')) {
            return (array) $this->attributes;
        }

        return [];
    }

    protected function getValidationData(): array
    {
        if (!empty($this->lightState)) {
            return $this->lightState;
        }

        $data = get_object_vars($this);

        foreach (['errorBag', 'rules', 'messages', 'attributes', 'lightState'] as $key) {
            unset($data[$key]);
        }

        foreach (array_keys($data) as $key) {
            if (str_starts_with($key, '__')) {
                unset($data[$key]);
            }
        }

        return $data;
    }

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

    public function validate($rules = null, $messages = null, $attributes = null): array
    {
        $validator = Validator::make(
            $this->getValidationData(),
            $rules ?? $this->getRules(),
            $messages ?? $this->getMessages(),
            $attributes ?? $this->getAttributes()
        );

        if ($validator->fails()) {
            $this->setErrorBag(new ViewErrorBag(['default' => $validator->errors()]));
            throw new ValidationException($validator);
        }

        $this->setErrorBag(new ViewErrorBag());

        return $validator->validated();
    }

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
            $this->setErrorBag(new ViewErrorBag(['default' => $validator->errors()]));
            throw new ValidationException($validator);
        }

        $this->setErrorBag(new ViewErrorBag());

        return $validator->validated();
    }

    public function run()
    {
        $this->bootLightvel();

        if (!request()->header('X-Light')) {
            return get_object_vars($this);
        }

        $original = $this->stateForClient();

        $payload = request()->json()->all();

        if (!is_array($payload) || empty($payload)) {
            $payload = request()->all();
        }

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

        $actionArgs = [];

        if (is_array($params)) {
            if (array_is_list($params)) {
                $actionArgs = $params;
            } else {
                $this->setState($params);
                request()->merge($params);
                $actionArgs = [];
            }
        }

        try {
            if (
                is_string($action)
                && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $action)
                && !in_array($action, ['run', 'lightvel'], true)
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
            $errors = $this->getErrorBag()->getBag('default')->toArray();
            $errors = empty($errors) ? [] : $errors;

            return response()->json([
                'status' => false,
                'message' => 'Validation failed',
                '__lightvel_errors' => $errors,
            ]);
        }

        return response()->json((object) []);
    }

    protected function invokeAction(string $action, array $actionArgs): mixed
    {
        $reflection = new ReflectionMethod($this, $action);
        $parameters = $reflection->getParameters();

        if (empty($parameters)) {
            return $this->$action(...$actionArgs);
        }

        $resolvedArgs = [];
        $argIndex = 0;

        foreach ($parameters as $parameter) {
            $type = $parameter->getType();

            if ($type instanceof ReflectionNamedType) {
                $typeName = $type->getName();

                if ($typeName === Request::class || is_subclass_of($typeName, Request::class)) {
                    $resolvedArgs[] = request();
                    continue;
                }
            }

            if (array_key_exists($argIndex, $actionArgs)) {
                $resolvedArgs[] = $actionArgs[$argIndex];
                $argIndex++;
                continue;
            }

            if ($parameter->isDefaultValueAvailable()) {
                $resolvedArgs[] = $parameter->getDefaultValue();
                continue;
            }

            $resolvedArgs[] = null;
        }

        return $this->$action(...$resolvedArgs);
    }
}
