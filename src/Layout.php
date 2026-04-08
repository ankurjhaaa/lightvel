<?php

namespace Lightvel;

#[\Attribute]
class Layout
{
    public function __construct(
        public string $view,
        public array $params = []
    ) {
    }
}
