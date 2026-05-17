"use client";

import React from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface BreadcrumbPart {
  label: string;
  path: string;
  level: number;
}

interface Props {
  crumbs: BreadcrumbPart[];
  rootLabel: string;
  onRootClick: () => void;
  onCrumbClick: (path: string, level: number) => void;
  className?: string;
}

export function PathBreadcrumb({ crumbs, rootLabel, onRootClick, onCrumbClick, className }: Props) {
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {crumbs.length === 0 ? (
          <BreadcrumbItem>
            <BreadcrumbPage>{rootLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        ) : (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={onRootClick} className="cursor-pointer">
                {rootLabel}
              </BreadcrumbLink>
            </BreadcrumbItem>
            {crumbs.map((crumb, i) => (
              <React.Fragment key={crumb.path}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {i === crumbs.length - 1 ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      onClick={() => onCrumbClick(crumb.path, crumb.level)}
                      className="cursor-pointer"
                    >
                      {crumb.label}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
