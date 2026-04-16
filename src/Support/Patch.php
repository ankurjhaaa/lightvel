<?php

namespace Lightvel\Support;

/**
 * Generates __patch payloads for efficient client-side array mutations.
 *
 * Usage:
 *   patch()->insert('users', $newId)       — Add item using form state
 *   patch()->update('users', $id)          — Update item using form state
 *   patch()->delete('users', $id)          — Remove item by id
 *
 * All operations send ONLY the ID — the JS runtime uses current form state
 * to build the data, keeping responses lightweight (minimal memory/bandwidth).
 *
 * @see resources/js/lightvel.js — applyPatchOperations() processes __patch
 */
class Patch
{
    /**
     * Delete item by ID from client-side array.
     */
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

    /**
     * Update item by ID — JS uses current form state values to update the row.
     * Send just the ID (like delete) to minimize response size.
     */
    public function update(string $resource, int|string $id): array
    {
        return [
            '__patch' => [
                $resource => [
                    'update' => [$id],
                ],
            ],
        ];
    }

    /**
     * Insert new item by ID — JS uses current form state values to create the row.
     * Send just the new ID (like delete) to minimize response size.
     */
    public function insert(string $resource, int|string $id): array
    {
        return [
            '__patch' => [
                $resource => [
                    'insert' => [$id],
                ],
            ],
        ];
    }
}
