<?php

namespace Lightvel\Support;

class Patch
{
    protected function normalizeItemPayload(mixed $item): array
    {
        if (is_array($item)) {
            return $item;
        }

        if (is_object($item)) {
            if (method_exists($item, 'attributesToArray')) {
                $payload = $item->attributesToArray();
                return is_array($payload) ? $payload : [];
            }

            if (method_exists($item, 'toArray')) {
                $payload = $item->toArray();
                return is_array($payload) ? $payload : [];
            }

            return get_object_vars($item);
        }

        return [];
    }

    public function delete(string $resource, int|string $id): array
    {
        return [
            '__patch' => [
                $resource => [
                    'delete' => [$id],
                ],
            ],
        ];
    }

    public function update(string $resource, mixed $item): array
    {
        return [
            '__patch' => [
                $resource => [
                    'update' => [$this->normalizeItemPayload($item)],
                ],
            ],
        ];
    }

    public function insert(string $resource, mixed $item): array
    {
        return [
            '__patch' => [
                $resource => [
                    'insert' => [$this->normalizeItemPayload($item)],
                ],
            ],
        ];
    }
}
