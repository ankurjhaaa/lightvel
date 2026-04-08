<?php

namespace Lightvel;

class Component
{
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

        if (
            is_string($action)
            && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $action)
            && !in_array($action, ['run', 'lightvel'], true)
            && method_exists($this, $action)
        ) {
            $this->$action(...$actionArgs);
        }

        $updated = get_object_vars($this);

        $diff = [];
        foreach ($updated as $k => $v) {
            if (($original[$k] ?? null) !== $v) {
                $diff[$k] = $v;
            }
        }

        return $diff;
    }
}
