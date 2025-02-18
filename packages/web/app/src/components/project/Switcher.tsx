import React from 'react';
import { VscChevronDown } from 'react-icons/vsc';
import { useQuery } from 'urql';
import { ProjectsDocument } from '@/graphql';
import { useRouteSelector } from '@/lib/hooks';
import { Button, Menu, MenuButton, MenuItem, MenuList, useColorModeValue } from '@chakra-ui/react';

export const ProjectSwitcher: React.FC<{
  organizationId: string;
  projectId: string;
}> = ({ organizationId, projectId }) => {
  const router = useRouteSelector();
  const [{ data }] = useQuery({
    query: ProjectsDocument,
    variables: {
      selector: {
        organization: organizationId,
      },
    },
  });
  const refinedData = React.useMemo(() => {
    if (!data?.projects?.nodes) {
      return null;
    }

    const currentProject = data?.projects?.nodes.find(node => node.cleanId === projectId);

    if (!currentProject) {
      return null;
    }

    return { items: data.projects.nodes, currentProject };
  }, [data]);

  const dropdownBgColor = useColorModeValue('white', 'gray.900');
  const dropdownTextColor = useColorModeValue('gray.700', 'gray.300');

  if (refinedData === null) {
    return null;
  }

  return (
    <Menu autoSelect={false}>
      <MenuButton
        size="sm"
        as={Button}
        rightIcon={<VscChevronDown />}
        variant="ghost"
        className="font-normal"
      >
        {refinedData.currentProject.name}
      </MenuButton>
      <MenuList bg={dropdownBgColor} color={dropdownTextColor}>
        {refinedData.items.map(item => {
          return (
            <MenuItem
              onClick={() => {
                router.visitProject({
                  organizationId,
                  projectId: item.cleanId,
                });
              }}
              key={item.cleanId}
            >
              {item.name}
            </MenuItem>
          );
        })}
      </MenuList>
    </Menu>
  );
};
