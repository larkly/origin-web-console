'use strict';

/**
 * @ngdoc function
 * @name openshiftConsole.controller:EditAutoscalerController
 * @description
 * # EditAutoscalerController
 * Controller of the openshiftConsole
 */
angular.module('openshiftConsole')
  .controller('EditAutoscalerController',
              function ($scope,
                        $filter,
                        $routeParams,
                        $window,
                        APIService,
                        AuthorizationService,
                        BreadcrumbsService,
                        DataService,
                        HPAService,
                        MetricsService,
                        Navigate,
                        ProjectsService,
                        keyValueEditorUtils) {
    if (!$routeParams.kind || !$routeParams.name) {
      Navigate.toErrorPage("Kind or name parameter missing.");
      return;
    }

    var supportedKinds = [
      'Deployment',
      'DeploymentConfig',
      'HorizontalPodAutoscaler',
      'ReplicaSet',
      'ReplicationController'
    ];

    if (!_.includes(supportedKinds, $routeParams.kind)) {
      Navigate.toErrorPage("Autoscaling not supported for kind " + $routeParams.kind + ".");
      return;
    }

    $scope.kind = $routeParams.kind;
    $scope.name = $routeParams.name;
    if ($routeParams.kind === "HorizontalPodAutoscaler") {
      // Wait for the HPA data to load before enabling the form controls.
      // This is only necessary when editing an existing HPA.
      $scope.disableInputs = true;
    } else {
      $scope.targetKind = $routeParams.kind;
      $scope.targetName = $routeParams.name;
    }

    $scope.autoscaling = {
      name: $scope.name
    };

    $scope.labels = [];

    // Warn if metrics aren't configured when setting autoscaling options.
    MetricsService.isAvailable().then(function(available) {
      $scope.metricsWarning = !available;
    });

    $scope.alerts = {};

    var getErrorDetails = $filter('getErrorDetails');

    var displayError = function(errorMessage, result) {
      $scope.alerts['autoscaling'] = {
        type: "error",
        message: errorMessage,
        details: getErrorDetails(result)
      };
    };

    ProjectsService
      .get($routeParams.project)
      .then(_.spread(function(project, context) {
        // Update project breadcrumb with display name.
        $scope.project = project;

        var verb = $routeParams.kind === 'HorizontalPodAutoscaler' ? 'update' : 'create';
        if (!AuthorizationService.canI({ resource: 'horizontalpodautoscalers', group: 'autoscaling' }, verb, $routeParams.project)) {
          Navigate.toErrorPage('You do not have authority to ' + verb + ' horizontal pod autoscalers in project ' + $routeParams.project + '.', 'access_denied');
          return;
        }

        var createHPA = function() {
          $scope.disableInputs = true;
          var hpa = {
            apiVersion: "autoscaling/v1",
            kind: "HorizontalPodAutoscaler",
            metadata: {
              name: $scope.autoscaling.name,
              labels: keyValueEditorUtils.mapEntries(keyValueEditorUtils.compactEntries($scope.labels))
            },
            spec: {
              scaleTargetRef: {
                kind: $routeParams.kind,
                name: $routeParams.name,
                apiVersion: "extensions/v1beta1",
                subresource: "scale"
              },
              minReplicas: $scope.autoscaling.minReplicas,
              maxReplicas: $scope.autoscaling.maxReplicas,
              targetCPUUtilizationPercentage: $scope.autoscaling.targetCPU || $scope.autoscaling.defaultTargetCPU || null
            }
          };

          DataService.create({
            resource: 'horizontalpodautoscalers',
            group: 'autoscaling'
          }, null, hpa, context)
            .then(function() { // Success
              _.set($scope, 'confirm.doneEditing', true);
              // Return to the previous page
              $window.history.back();
            }, function(result) { // Failure
              $scope.disableInputs = false;
              displayError('An error occurred creating the horizontal pod autoscaler.', result);
            });
        };

        var updateHPA = function(hpa) {
          $scope.disableInputs = true;

          hpa = angular.copy(hpa);
          hpa.metadata.labels = keyValueEditorUtils.mapEntries(keyValueEditorUtils.compactEntries($scope.labels));
          hpa.spec.minReplicas = $scope.autoscaling.minReplicas;
          hpa.spec.maxReplicas = $scope.autoscaling.maxReplicas;
          hpa.spec.targetCPUUtilizationPercentage = $scope.autoscaling.targetCPU || $scope.autoscaling.defaultTargetCPU || null;

          DataService.update({
            resource: 'horizontalpodautoscalers',
            group: 'autoscaling'
          }, hpa.metadata.name, hpa, context)
            .then(function() { // Success
              _.set($scope, 'confirm.doneEditing', true);
              // Return to the previous page
              $window.history.back();
            }, function(result) { // Failure
              $scope.disableInputs = false;
              displayError('An error occurred updating horizontal pod autoscaler "' + hpa.metadata.name + '".', result);
            });
        };

        var resourceGroup = {};
        if ($routeParams.kind === "HorizontalPodAutoscaler") {
          // Fetch the HPA we're editing. This form knows how to edit autoscaling/v1 HPA objects
          resourceGroup = {
            resource: "horizontalpodautoscalers",
            group: "autoscaling",
            version: "v1"
          };
        } else {
          // Fetch the resource we're going to create an HPA for
          resourceGroup = {
            resource: APIService.kindToResource($routeParams.kind),
            group: $routeParams.group
          };
        }

        DataService.get(resourceGroup, $routeParams.name, context).then(function(resource) {
          $scope.labels = _.map(
                            _.get(resource, 'metadata.labels', {}),
                            function(val, key) {
                              return {
                                name: key,
                                value: val
                              };
                            });

          // Are we editing an existing HPA?
          if ($routeParams.kind === "HorizontalPodAutoscaler") {
            $scope.targetKind = _.get(resource, 'spec.scaleTargetRef.kind');
            $scope.targetName = _.get(resource, 'spec.scaleTargetRef.name');
            _.assign($scope.autoscaling, {
              minReplicas: _.get(resource, 'spec.minReplicas'),
              maxReplicas: _.get(resource, 'spec.maxReplicas'),
              targetCPU: _.get(resource, 'spec.targetCPUUtilizationPercentage')
            });
            $scope.disableInputs = false;

            // Update the existing HPA.
            $scope.save = function() {
              updateHPA(resource);
            };

            // Build the breadcrumb for the target resource. (HPAs don't have a dedicated page.)
            $scope.breadcrumbs = BreadcrumbsService.getBreadcrumbs({
              name: $scope.targetName,
              kind: $scope.targetKind,
              namespace: $routeParams.project,
              project: project,
              subpage: 'Autoscale',
              includeProject: true
            });
          } else {
            $scope.breadcrumbs = BreadcrumbsService.getBreadcrumbs({
              object: resource,
              project: project,
              subpage: 'Autoscale',
              includeProject: true
            });

            // Create a new HPA.
            $scope.save = createHPA;

            var limitRanges = {};
            var checkCPURequest = function() {
              var containers = _.get(resource, 'spec.template.spec.containers', []);
              $scope.showCPURequestWarning = !HPAService.hasCPURequest(containers, limitRanges, project);
            };

            // List limit ranges in this project to determine if there is a default
            // CPU request for autoscaling.
            DataService.list("limitranges", context).then(function(resp) {
              limitRanges = resp.by("metadata.name");
              checkCPURequest();
            });
          }
        });
    }));
  });
