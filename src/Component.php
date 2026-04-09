<?php

namespace Lightvel;

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\ViewErrorBag;
use Illuminate\Validation\ValidationException;

class Component
{
    protected ?ViewErrorBag $errorBag = null;

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
        $data = get_object_vars($this);

        foreach (['errorBag', 'rules', 'messages', 'attributes'] as $key) {
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
        if (!request()->header('X-Light')) {
            if (method_exists($this, 'lightvel')) {
                $this->lightvel();
            }

            return get_object_vars($this);
        }

        $original = get_object_vars($this);

        $payload = request()->json()->all();
        $action = $payload['action'] ?? null;
        $params = $payload['params'] ?? [];

        $actionArgs = [];

        if (is_array($params)) {
            if (array_is_list($params)) {
                $actionArgs = $params;
            } else {
                foreach ($params as $k => $v) {
                    if (property_exists($this, $k)) {
                        $this->$k = $v;
                    }
                }
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
                $this->$action(...$actionArgs);
            }
        } catch (ValidationException $e) {
            $errors = $this->getErrorBag()->getBag('default')->toArray();
            $errors = empty($errors) ? [] : $errors;

            return [
                '__lightvel_errors' => $errors,
            ];
        }

        $updated = get_object_vars($this);

        $diff = [];
        foreach ($updated as $k => $v) {
            if (($original[$k] ?? null) !== $v) {
                $diff[$k] = $v;
            }
        }

        $errors = $this->getErrorBag()->getBag('default')->toArray();
        $diff['__lightvel_errors'] = empty($errors) ? [] : $errors;

        return $diff;
    }
}
