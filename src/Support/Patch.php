<?php

namespace Lightvel\Support;

use Illuminate\Database\Eloquent\Model;

/**
 * Generates __patch payloads for surgical client-side array mutations.
 *
 * Usage — all three operations follow the same pattern:
 *
 *   patch()->delete('users', $id)
 *   patch()->update('users', $user)       ← pass model or [id => ..., fields...]
 *   patch()->insert('users', $user)       ← pass model or [id => ..., fields...]
 *
 * Models are serialized via attributesToArray() (respects $hidden, $casts).
 *
 * @see resources/js/lightvel.js — applyPatchOperations() handles __patch
 */
class Patch
{
    /**
     * Delete item(s) by ID from client-side array.
     *
     * @param string $resource State key (e.g. 'users')
     * @param int|string|array $ids Single ID or array of IDs
     */
    public function delete(string $resource, int|string|array $ids): array
    {
        $ids = is_array($ids) ? $ids : [$ids];

        return [
            '__patch' => [
                $resource => [
                    'delete' => $ids,
                ],
            ],
        ];
    }

    /**
     * Update item(s) in client-side array.
     *
     * @param string $resource State key (e.g. 'users')
     * @param Model|array $item Eloquent model or associative array with 'id'
     */
    public function update(string $resource, Model|array $item): array
    {
        $data = $item instanceof Model ? $item->attributesToArray() : $item;

        return [
            '__patch' => [
                $resource => [
                    'update' => [$data],
                ],
            ],
        ];
    }

    /**
     * Insert item(s) into client-side array (prepend).
     *
     * @param string $resource State key (e.g. 'users')
     * @param Model|array $item Eloquent model or associative array with 'id'
     */
    public function insert(string $resource, Model|array $item): array
    {
        $data = $item instanceof Model ? $item->attributesToArray() : $item;

        return [
            '__patch' => [
                $resource => [
                    'insert' => [$data],
                ],
            ],
        ];
    }
}
