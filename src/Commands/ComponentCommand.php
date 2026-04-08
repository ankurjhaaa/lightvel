<?php

namespace Lightvel\Commands;

class ComponentCommand extends MakeCommand
{
    protected $signature = 'lightvel:component {name : Example: pages::app.home or pages.home} {--force : Overwrite the view if it already exists}';

    protected $description = 'Create a Lightvel component view';
}
